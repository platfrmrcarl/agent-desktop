import { useState } from 'react'

export function SetPasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    if (pwd.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (pwd !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await window.agent.server.setPassword(pwd)
      onSaved()
    } catch (err) {
      setError((err as Error).message || 'Failed to save password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="p-6 rounded-lg w-full max-w-sm space-y-3 border shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text)',
          borderColor: 'color-mix(in srgb, var(--color-text-muted) 20%, transparent)',
        }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-contrast)' }}>Set web server password</h2>
        <label className="block text-sm">
          New password
          <input type="password" autoFocus required value={pwd} onChange={(e) => setPwd(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)' }} />
        </label>
        <label className="block text-sm">
          Confirm password
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)' }} />
        </label>
        {error && <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border"
            style={{ borderColor: 'color-mix(in srgb, var(--color-text-muted) 30%, transparent)', color: 'var(--color-text)' }}>Cancel</button>
          <button type="submit" disabled={busy} className="px-3 py-1 rounded font-medium"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-contrast)', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
