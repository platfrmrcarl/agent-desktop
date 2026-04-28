import { useCallback, useEffect, useState } from 'react'
import type { Macro } from '../../../shared/types'
import { tint } from '../../utils/colorMix'

const MACRO_NAME_RE = /^[a-zA-Z0-9_-]+$/

function notifyMacrosChanged(): void {
  window.dispatchEvent(new CustomEvent('macros-changed'))
}

interface MacrosSettingsProps {}

export function MacrosSettings(_props: MacrosSettingsProps = {}) {
  const [macros, setMacros] = useState<Macro[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editing, setEditing] = useState<Macro | null>(null)
  const [showForm, setShowForm] = useState(false)

  const loadList = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await window.agent.macros.list()
      setMacros(list)
    } catch {
      setMacros([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  const handleAdd = useCallback(() => {
    setEditing(null)
    setShowForm(true)
  }, [])

  const handleEdit = useCallback((macro: Macro) => {
    setEditing(macro)
    setShowForm(true)
  }, [])

  const handleCloseForm = useCallback(
    async (saved: boolean) => {
      setShowForm(false)
      setEditing(null)
      if (saved) {
        notifyMacrosChanged()
        await loadList()
      }
    },
    [loadList]
  )

  const handleDelete = useCallback(
    async (macro: Macro) => {
      if (!window.confirm(`Supprimer la macro /${macro.name} ?`)) return
      try {
        await window.agent.macros.delete(macro.name)
        notifyMacrosChanged()
        await loadList()
      } catch (err) {
        window.alert(`Erreur : ${(err as Error).message}`)
      }
    },
    [loadList]
  )

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-body">Macros</h2>
          <p className="text-xs text-muted mt-0.5">
            Séquences de messages envoyés en rafale via <code>/nom</code>. Stockées dans{' '}
            <code>~/.agent-desktop/macros</code>.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 bg-primary text-contrast"
        >
          Ajouter
        </button>
      </div>

      {isLoading ? (
        <div className="px-3 py-4 text-sm text-muted">Chargement…</div>
      ) : macros.length === 0 ? (
        <div className="text-sm py-4 text-center text-muted">
          Aucune macro — cliquez sur « Ajouter » pour créer la première.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {macros.map((macro) => (
            <div key={macro.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-deep">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-medium text-body">/{macro.name}</span>
                  <span className="text-[0.625rem] font-bold px-1 py-0.5 rounded text-contrast bg-tool">
                    {macro.messages.length} msg
                  </span>
                </div>
                <div className="text-xs truncate text-muted">
                  {macro.description || '—'}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleEdit(macro)}
                  className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 bg-surface text-body"
                  title="Éditer"
                >
                  Éditer
                </button>
                <button
                  onClick={() => handleDelete(macro)}
                  className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 bg-surface text-error"
                  title="Supprimer"
                >
                  Suppr.
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <MacroForm existing={editing} existingNames={macros.map((m) => m.name)} onClose={handleCloseForm} />}
    </div>
  )
}

interface MacroFormProps {
  existing: Macro | null
  existingNames: string[]
  onClose: (saved: boolean) => void
}

function MacroForm({ existing, existingNames, onClose }: MacroFormProps) {
  const isEdit = existing != null
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [messages, setMessages] = useState<string[]>(existing?.messages.length ? existing.messages : [''])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addMessage = useCallback(() => {
    setMessages((prev) => [...prev, ''])
  }, [])

  const updateMessage = useCallback((idx: number, value: string) => {
    setMessages((prev) => prev.map((m, i) => (i === idx ? value : m)))
  }, [])

  const removeMessage = useCallback((idx: number) => {
    setMessages((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)))
  }, [])

  const moveMessage = useCallback((idx: number, delta: -1 | 1) => {
    setMessages((prev) => {
      const target = idx + delta
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const tmp = next[idx]
      next[idx] = next[target]
      next[target] = tmp
      return next
    })
  }, [])

  const validate = useCallback((): string | null => {
    const trimmedName = name.trim()
    if (!trimmedName) return 'Le nom est requis.'
    if (!MACRO_NAME_RE.test(trimmedName)) return 'Nom invalide : lettres, chiffres, tirets et underscores uniquement.'
    if (trimmedName.length > 64) return 'Nom trop long (64 caractères max).'
    if (!isEdit || trimmedName !== existing?.name) {
      if (existingNames.includes(trimmedName)) return `Une macro /${trimmedName} existe déjà.`
    }
    const cleaned = messages.map((m) => m).filter((m) => m.trim().length > 0)
    if (cleaned.length === 0) return 'Au moins un message non vide est requis.'
    return null
  }, [name, isEdit, existing, existingNames, messages])

  const handleSave = useCallback(async () => {
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const trimmedName = name.trim()
      const cleanedMessages = messages.map((m) => m).filter((m) => m.trim().length > 0)
      const oldName = isEdit && existing && existing.name !== trimmedName ? existing.name : undefined
      await window.agent.macros.save(trimmedName, description.trim(), cleanedMessages, oldName)
      onClose(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [validate, name, description, messages, isEdit, existing, onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false)
      }}
    >
      <div
        className="w-full max-w-2xl rounded-lg shadow-xl flex flex-col max-h-[85vh]"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <h3 className="text-base font-semibold text-body">
            {isEdit ? `Éditer /${existing?.name}` : 'Nouvelle macro'}
          </h3>
          <button
            onClick={() => onClose(false)}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--color-bg)] text-muted"
            aria-label="Fermer"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M1.05 1.05a.5.5 0 01.707 0L7 6.293l5.243-5.243a.5.5 0 11.707.707L7.707 7l5.243 5.243a.5.5 0 11-.707.707L7 7.707l-5.243 5.243a.5.5 0 01-.707-.707L6.293 7 1.05 1.757a.5.5 0 010-.707z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Nom (invocation /nom)</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="example"
              className="px-2 py-1.5 rounded border bg-deep text-body font-mono text-sm"
              style={{ borderColor: 'var(--color-text-muted)' }}
              autoFocus={!isEdit}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Description (facultatif)</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="À quoi sert cette macro ?"
              className="px-2 py-1.5 rounded border bg-deep text-body text-sm"
              style={{ borderColor: 'var(--color-text-muted)' }}
            />
          </label>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">
                Messages ({messages.length})
              </span>
              <button
                type="button"
                onClick={addMessage}
                className="px-2 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80 bg-surface text-body"
              >
                + Ajouter un message
              </button>
            </div>
            {messages.map((msg, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex flex-col gap-0.5 pt-1">
                  <span className="text-[0.625rem] font-mono text-muted text-center">
                    #{idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveMessage(idx, -1)}
                    disabled={idx === 0}
                    className="w-6 h-6 flex items-center justify-center rounded text-xs bg-surface text-body hover:opacity-80 disabled:opacity-30"
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMessage(idx, 1)}
                    disabled={idx === messages.length - 1}
                    className="w-6 h-6 flex items-center justify-center rounded text-xs bg-surface text-body hover:opacity-80 disabled:opacity-30"
                    title="Descendre"
                  >
                    ↓
                  </button>
                </div>
                <textarea
                  value={msg}
                  onChange={(e) => updateMessage(idx, e.target.value)}
                  placeholder={idx === 0 ? 'Premier message…' : `Message ${idx + 1}`}
                  rows={Math.min(6, Math.max(2, msg.split('\n').length))}
                  className="flex-1 px-2 py-1.5 rounded border bg-deep text-body text-sm resize-y font-mono"
                  style={{ borderColor: 'var(--color-text-muted)' }}
                />
                <button
                  type="button"
                  onClick={() => removeMessage(idx)}
                  disabled={messages.length <= 1}
                  className="px-2 py-1 rounded text-xs font-medium bg-surface text-error hover:opacity-80 disabled:opacity-30 mt-1"
                  title="Supprimer ce message"
                >
                  ×
                </button>
              </div>
            ))}
            <p className="text-[0.7rem] text-muted">
              Astuce : un message peut être une commande slash (par ex. <code>/clear</code>) — elle sera exécutée en séquence.
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 rounded text-xs border-l-[3px] border-l-error result-bg-error text-error">
              {error}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: tint('--color-text-muted', 10) }}
        >
          <button
            onClick={() => onClose(false)}
            disabled={saving}
            className="px-3 py-1.5 rounded text-sm font-medium bg-surface text-body hover:opacity-80 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded text-sm font-medium bg-primary text-contrast hover:opacity-80 disabled:opacity-40"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
