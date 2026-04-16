import { useState } from 'react'
import { useGitPanelStore } from '../../../stores/gitPanelStore'

export function GitStash({ cwd }: { cwd: string }) {
  const stashes = useGitPanelStore((s) => s.stashes)
  const stashSave = useGitPanelStore((s) => s.stashSave)
  const stashPop = useGitPanelStore((s) => s.stashPop)
  const error = useGitPanelStore((s) => s.errors.stash)
  const [msg, setMsg] = useState('')

  return (
    <div className="text-xs flex flex-col h-full">
      <div className="p-2 border-b border-[color:var(--contrast-12)] flex gap-1">
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Message (optionnel)"
          className="flex-1 px-2 py-1 bg-[color:var(--base)] border border-[color:var(--contrast-12)] rounded"
        />
        <button
          onClick={() => { stashSave(cwd, msg || undefined); setMsg('') }}
          className="px-2 py-1 bg-[color:var(--accent)] text-[color:var(--contrast)] rounded"
        >
          Stash
        </button>
      </div>
      {error && <div className="p-2 text-[color:var(--danger)]">Erreur: {error.kind}</div>}
      <ul className="flex-1 overflow-auto">
        {(stashes ?? []).map((s) => (
          <li key={s.index} className="flex items-center gap-2 px-3 py-1.5 border-b border-[color:var(--contrast-12)]">
            <span className="font-mono opacity-60">#{s.index}</span>
            <span className="truncate flex-1">{s.message}</span>
            <button
              onClick={() => stashPop(cwd, s.index)}
              className="px-2 py-0.5 rounded hover:bg-[color:color-mix(in_srgb,var(--contrast)_10%,transparent)]"
            >
              Pop
            </button>
          </li>
        ))}
        {stashes && stashes.length === 0 && <li className="p-3 opacity-70">Aucun stash.</li>}
      </ul>
    </div>
  )
}
