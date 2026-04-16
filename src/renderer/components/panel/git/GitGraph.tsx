import { useMemo } from 'react'
import { useGitPanelStore } from '../../../stores/gitPanelStore'
import { layout } from './graph/layout'

const TRACK_WIDTH = 18
const ROW_HEIGHT = 28
const NODE_RADIUS = 5
const LEFT_PAD = 12
const TOP_PAD = 16

export function GitGraph({ cwd }: { cwd: string }) {
  const commits = useGitPanelStore((s) => s.commits)
  const selected = useGitPanelStore((s) => s.selectedCommitSha)
  const select = useGitPanelStore((s) => s.selectCommit)

  const graph = useMemo(() => (commits && commits.length > 0 ? layout(commits) : null), [commits])

  if (!commits || commits.length === 0) {
    return <div className="p-4 text-sm opacity-70">Aucun commit.</div>
  }
  if (!graph) return null

  const svgWidth = LEFT_PAD * 2 + graph.columns * TRACK_WIDTH
  const svgHeight = TOP_PAD * 2 + graph.nodes.length * ROW_HEIGHT

  return (
    <div className="overflow-auto h-full">
      <div className="flex items-start" style={{ minHeight: svgHeight }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          role="img"
          aria-label={`Git graph, ${commits.length} commits`}
          className="shrink-0"
        >
          {graph.edges.map((e, i) => {
            const x1 = LEFT_PAD + e.from.x * TRACK_WIDTH
            const y1 = TOP_PAD + e.from.y * ROW_HEIGHT
            const x2 = LEFT_PAD + e.to.x * TRACK_WIDTH
            const y2 = TOP_PAD + e.to.y * ROW_HEIGHT
            const d =
              e.kind === 'direct'
                ? `M ${x1} ${y1} L ${x2} ${y2}`
                : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
            return <path key={i} d={d} stroke={e.color} strokeWidth={1.5} fill="none" />
          })}
          {graph.nodes.map((n) => (
            <circle
              key={n.commit.sha}
              cx={LEFT_PAD + n.x * TRACK_WIDTH}
              cy={TOP_PAD + n.y * ROW_HEIGHT}
              r={NODE_RADIUS}
              fill={n.color}
              stroke={selected === n.commit.sha ? 'var(--contrast)' : 'none'}
              strokeWidth={selected === n.commit.sha ? 2 : 0}
            />
          ))}
        </svg>
        <ul className="flex-1 text-xs" style={{ marginTop: TOP_PAD - ROW_HEIGHT / 2 - 2 }}>
          {graph.nodes.map((n) => (
            <li key={n.commit.sha} style={{ height: ROW_HEIGHT }} className="flex items-center">
              <button
                aria-label={n.commit.shortSha}
                onClick={() => select(cwd, n.commit.sha)}
                className={`flex items-center gap-2 w-full px-2 py-0.5 text-left rounded hover:bg-[color:color-mix(in_srgb,var(--contrast)_10%,transparent)] ${
                  selected === n.commit.sha
                    ? 'bg-[color:color-mix(in_srgb,var(--accent)_15%,transparent)]'
                    : ''
                }`}
              >
                <span className="font-mono text-[10px] opacity-70">{n.commit.shortSha}</span>
                <span className="truncate flex-1">{n.commit.subject}</span>
                {n.commit.refs.length > 0 && (
                  <span className="text-[10px] px-1 rounded bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)]">
                    {n.commit.refs[0]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
