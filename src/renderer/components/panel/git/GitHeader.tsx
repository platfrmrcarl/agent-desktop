import { useGitPanelStore } from '../../../stores/gitPanelStore'

export function GitHeader({ cwd }: { cwd: string }) {
  const status = useGitPanelStore((s) => s.status)
  const refresh = useGitPanelStore((s) => s.refresh)
  const loading = useGitPanelStore((s) => Object.values(s.loading).some(Boolean))

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--contrast-12)] text-xs">
      <span className="font-semibold">
        {status?.detached ? '⚠ detached' : status?.branch ?? '…'}
      </span>
      {status?.upstream && (
        <span className="opacity-70">↑{status.ahead} ↓{status.behind}</span>
      )}
      <div className="flex-1" />
      <button
        onClick={() => refresh(cwd)}
        disabled={loading}
        className="px-2 py-0.5 rounded hover:bg-[color:color-mix(in_srgb,var(--contrast)_10%,transparent)] disabled:opacity-40"
        aria-label="Refresh"
      >
        {loading ? '…' : '↻'}
      </button>
    </div>
  )
}
