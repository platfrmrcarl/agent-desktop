import { useEffect, useRef, useState } from 'react'
import { useBugReportStore } from '../../stores/bugReportStore'
import { rendererErrorBuffer } from '../../bootstrap/rendererErrorCapture'

type SendResult =
  | { ok: true }
  | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number }

function formatEntry(e: {
  timestamp: string
  source: string
  level: string
  message: string
}): string {
  return `[${e.timestamp}] [${e.source}] ${e.message}`
}

export function BugReportModal(): JSX.Element | null {
  const isOpen = useBugReportStore((s) => s.isOpen)
  const prefillDescription = useBugReportStore((s) => s.prefillDescription)
  const close = useBugReportStore((s) => s.close)
  const markSent = useBugReportStore((s) => s.markSent)

  const [description, setDescription] = useState('')
  const [logs, setLogs] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setDescription(prefillDescription)
    setError(null)
    void refreshLogs()
    return () => {
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  async function refreshLogs(): Promise<void> {
    try {
      const main = await window.agent.bugReport.getMainErrors()
      const renderer = rendererErrorBuffer.getAll()
      const merged = [...main, ...renderer].sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
      )
      const raw = merged.map(formatEntry).join('\n')
      const scrubbed = await window.agent.bugReport.scrub(raw)
      setLogs(scrubbed)
    } catch {
      setLogs('')
    }
  }

  function startCountdown(ms: number): void {
    setCountdown(Math.ceil(ms / 1000))
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    countdownTimer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownTimer.current) {
            clearInterval(countdownTimer.current)
            countdownTimer.current = null
          }
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function handleSend(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const result = (await window.agent.bugReport.send({ description, logs })) as SendResult
      if (result.ok) {
        markSent()
        setTimeout(() => close(), 1000)
      } else if (result.error === 'rate_limited') {
        startCountdown(result.retryAfterMs)
        setError('Merci de patienter avant un nouvel envoi.')
      } else if (result.error === 'not_configured') {
        setError('Fonctionnalité désactivée en développement.')
      } else if (result.error === 'timeout') {
        setError('Délai dépassé, réessaye.')
      } else {
        setError('Impossible d\u2019envoyer le rapport. Réessaye plus tard.')
      }
    } finally {
      setSending(false)
    }
  }

  if (!isOpen) return null

  const canSend =
    !sending && countdown === 0 && (description.trim().length > 0 || logs.trim().length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-2xl flex flex-col gap-4 p-6"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Signaler un bug</h2>
          <button
            onClick={close}
            className="text-sm"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--color-text-muted)' }}>Description (optionnelle)</span>
          <textarea
            data-testid="bug-description-textarea"
            className="rounded p-2 text-sm"
            rows={3}
            placeholder="Que faisais-tu quand le bug est apparu ?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-deep)',
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center justify-between">
            <span style={{ color: 'var(--color-text-muted)' }}>Logs à envoyer (éditables)</span>
            <button
              type="button"
              onClick={() => void refreshLogs()}
              className="text-xs underline"
              style={{ color: 'var(--color-primary)' }}
            >
              Refresh logs
            </button>
          </span>
          <textarea
            data-testid="bug-logs-textarea"
            className="rounded p-2 text-xs font-mono"
            rows={10}
            value={logs}
            onChange={(e) => setLogs(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-deep)',
            }}
          />
        </label>

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Metadata auto-ajoutées : version, OS, session (X11/Wayland), backend AI, thème actif.
        </p>

        {error && (
          <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="bug-cancel-button"
            onClick={close}
            className="px-4 py-2 rounded text-sm"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
          >
            Annuler
          </button>
          <button
            data-testid="bug-send-button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-contrast)' }}
          >
            {sending
              ? 'Envoi\u2026'
              : countdown > 0
                ? `Réessaye dans ${countdown}s`
                : 'Envoyer le rapport'}
          </button>
        </div>
      </div>
    </div>
  )
}
