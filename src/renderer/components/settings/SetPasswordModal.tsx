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
        className="p-6 rounded-lg w-full max-w-sm space-y-3"
        style={{ background: 'var(--color-base)', color: 'var(--color-body)' }}
      >
        <h2 className="text-base font-semibold">Set web server password</h2>
        <label className="block text-sm">
          New password
          <input type="password" autoFocus required value={pwd} onChange={(e) => setPwd(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border" style={{ background: 'var(--color-base)', borderColor: 'var(--color-muted)' }} />
        </label>
        <label className="block text-sm">
          Confirm password
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border" style={{ background: 'var(--color-base)', borderColor: 'var(--color-muted)' }} />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border" style={{ borderColor: 'var(--color-muted)' }}>Cancel</button>
          <button type="submit" disabled={busy} className="px-3 py-1 rounded" style={{ background: 'var(--color-primary)', color: 'white' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
