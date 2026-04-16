import { useGitPanelStore } from '../../../stores/gitPanelStore'
import type { GitFileStatus } from '@shared/git-types'

function colorFor(char: GitFileStatus['index'] | GitFileStatus['worktree']): string {
  switch (char) {
    case 'M': return 'var(--color-warning)'
    case 'A': return 'var(--color-success)'
    case 'D': return 'var(--color-error)'
    case 'R': return 'var(--color-tool)'
    case 'C': return 'var(--color-tool)'
    case '?': return 'color-mix(in srgb, var(--color-text) 60%, transparent)'
    default: return 'transparent'
  }
}

export function GitStatus() {
  const status = useGitPanelStore((s) => s.status)
  const error = useGitPanelStore((s) => s.errors.status)
  const loading = useGitPanelStore((s) => s.loading.status)

  if (loading && !status) return <div className="p-3 text-xs opacity-70">Chargement…</div>
  if (error) return <div className="p-3 text-xs text-[color:var(--color-error)]">Erreur: {error.kind}</div>
  if (!status) return null
  if (status.clean) return <div className="p-3 text-xs opacity-70">Working tree propre.</div>

  return (
    <ul className="text-xs font-mono p-1">
      {status.files.map((f) => (
        <li key={f.path} className="flex items-center gap-2 py-0.5 px-2">
          <span style={{ color: colorFor(f.index) }} className="w-3 text-center">
            {f.index !== '.' ? f.index : ' '}
          </span>
          <span style={{ color: colorFor(f.worktree) }} className="w-3 text-center">
            {f.worktree !== '.' ? f.worktree : ' '}
          </span>
          <span className="truncate">
            {f.renamedFrom ? <><span className="opacity-60">{f.renamedFrom} → </span>{f.path}</> : f.path}
          </span>
        </li>
      ))}
    </ul>
  )
}
