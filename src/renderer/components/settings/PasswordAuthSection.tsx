import { useCallback, useEffect, useState } from 'react'
import { SetPasswordModal } from './SetPasswordModal'

export function PasswordAuthSection({ accessMode }: { accessMode: 'lan' | 'all' }) {
  const [isSet, setIsSet] = useState<boolean | null>(null)
  const [sessionDays, setSessionDays] = useState(7)
  const [rememberDays, setRememberDays] = useState(30)
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [set, s, r] = await Promise.all([
        window.agent.server.isPasswordSet(),
        window.agent.server.getSessionDurationDays(),
        window.agent.server.getRememberDurationDays(),
      ])
      setIsSet(set)
      setSessionDays(s)
      setRememberDays(r)
    } catch {
      setIsSet(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleDisable(): Promise<void> {
    if (!window.confirm('Disable password authentication? All active sessions will be logged out.')) return
    await window.agent.server.clearPassword()
    await refresh()
  }

  async function commitSessionDays(v: number): Promise<void> {
    if (v < 1) return
    await window.agent.server.setSessionDurationDays(v)
    setSessionDays(v)
  }

  async function commitRememberDays(v: number): Promise<void> {
    if (v < 1) return
    await window.agent.server.setRememberDurationDays(v)
    setRememberDays(v)
  }

  if (isSet === null) return null

  return (
    <div className="mt-4 p-3 rounded border" style={{ borderColor: 'var(--color-muted)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Password authentication</h3>
        <span className="text-xs" style={{ color: isSet ? 'var(--color-primary)' : 'var(--color-muted)' }}>
          {isSet ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {!isSet && accessMode === 'all' && (
        <div className="mb-3 p-2 text-xs rounded" style={{ background: 'color-mix(in srgb, red 15%, transparent)', color: 'var(--color-body)' }}>
          ⚠ Internet access enabled without a password. Enable a password to protect your data.
        </div>
      )}

      {isSet ? (
        <>
          <div className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Password is set.</div>
          <div className="flex items-center gap-3 mb-2 text-xs">
            <label className="flex items-center gap-2">Session (days)
              <input type="number" min={1} value={sessionDays} onChange={(e) => commitSessionDays(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-1 py-0.5 rounded border" style={{ borderColor: 'var(--color-muted)', background: 'var(--color-base)' }} />
            </label>
            <label className="flex items-center gap-2">Remember me (days)
              <input type="number" min={1} value={rememberDays} onChange={(e) => commitRememberDays(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-1 py-0.5 rounded border" style={{ borderColor: 'var(--color-muted)', background: 'var(--color-base)' }} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(true)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-muted)' }}>Change password</button>
            <button onClick={handleDisable} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-muted)', color: 'var(--color-danger, red)' }}>Disable</button>
          </div>
        </>
      ) : (
        <button onClick={() => setModalOpen(true)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-primary)', color: 'white' }}>Set password</button>
      )}

      {modalOpen && <SetPasswordModal onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); refresh() }} />}
    </div>
  )
}
