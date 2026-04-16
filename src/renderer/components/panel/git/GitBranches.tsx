import { useGitPanelStore } from '../../../stores/gitPanelStore'

export function GitBranches({ cwd }: { cwd: string }) {
  const branches = useGitPanelStore((s) => s.branches)
  const checkout = useGitPanelStore((s) => s.checkout)
  const error = useGitPanelStore((s) => s.errors.branches)

  if (error) return <div className="p-3 text-xs text-[color:var(--color-error)]">Erreur: {error.kind}</div>
  if (!branches) return <div className="p-3 text-xs opacity-70">Chargement…</div>

  const local = branches.filter((b) => !b.isRemote)
  const remote = branches.filter((b) => b.isRemote)

  return (
    <div className="text-xs">
      <div className="px-3 py-1.5 opacity-70 uppercase text-[10px] tracking-wide">Locales</div>
      <ul>
        {local.map((b) => (
          <li key={b.name}>
            <button
              disabled={b.isCurrent}
              onClick={() => checkout(cwd, b.name)}
              className={`w-full text-left px-3 py-1 hover:bg-[color:color-mix(in_srgb,var(--color-text)_10%,transparent)] flex items-center gap-2 ${
                b.isCurrent ? 'opacity-100 font-semibold' : ''
              } disabled:cursor-default`}
              aria-label={b.name}
            >
              <span className="w-3">{b.isCurrent ? '●' : ' '}</span>
              <span className="flex-1 truncate">{b.name}</span>
              {b.upstream && <span className="opacity-60">↑{b.ahead} ↓{b.behind}</span>}
            </button>
          </li>
        ))}
      </ul>
      {remote.length > 0 && (
        <>
          <div className="px-3 py-1.5 mt-2 opacity-70 uppercase text-[10px] tracking-wide">Remotes</div>
          <ul>
            {remote.map((b) => (
              <li key={b.name} className="px-3 py-1 opacity-70 truncate">{b.name}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
