import { useMemo } from 'react'
import { useGitPanelStore } from '../../../stores/gitPanelStore'
import { layout } from './graph/layout'
import type { GraphEdge } from './graph/types'

const TRACK_WIDTH = 22
const ROW_HEIGHT = 30
const NODE_RADIUS = 6
const INNER_RADIUS = 2.5
const LEFT_PAD = 14

interface RefBadge {
  label: string
  kind: 'head' | 'branch' | 'remote' | 'tag'
}

function classifyRef(raw: string, remoteNames: Set<string>): RefBadge {
  if (raw.startsWith('HEAD -> ')) return { label: raw.slice('HEAD -> '.length), kind: 'head' }
  if (raw === 'HEAD') return { label: 'HEAD', kind: 'head' }
  if (raw.startsWith('tag: ')) return { label: raw.slice('tag: '.length), kind: 'tag' }
  if (remoteNames.has(raw)) return { label: raw, kind: 'remote' }
  return { label: raw, kind: 'branch' }
}

function refClasses(kind: RefBadge['kind']): string {
  switch (kind) {
    case 'head':
      return 'bg-[color:color-mix(in_srgb,var(--color-accent)_35%,transparent)] border-[color:var(--color-accent)]'
    case 'branch':
      return 'bg-[color:color-mix(in_srgb,var(--color-accent)_20%,transparent)] border-[color:color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
    case 'remote':
      return 'bg-[color:color-mix(in_srgb,var(--color-tool)_20%,transparent)] border-[color:color-mix(in_srgb,var(--color-tool)_40%,transparent)]'
    case 'tag':
      return 'bg-[color:color-mix(in_srgb,var(--color-warning)_25%,transparent)] border-[color:color-mix(in_srgb,var(--color-warning)_45%,transparent)]'
  }
}

function pathFor(edge: GraphEdge): string {
  const x1 = LEFT_PAD + edge.from.x * TRACK_WIDTH
  const y1 = edge.from.y * ROW_HEIGHT + ROW_HEIGHT / 2
  const x2 = LEFT_PAD + edge.to.x * TRACK_WIDTH
  const y2 = edge.to.y * ROW_HEIGHT + ROW_HEIGHT / 2
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const dy = Math.abs(y2 - y1)
  const bend = Math.min(dy * 0.45, ROW_HEIGHT)
  const c1y = y2 > y1 ? y1 + bend : y1 - bend
  const c2y = y2 > y1 ? y2 - bend : y2 + bend
  return `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`
}

export function GitGraph({ cwd }: { cwd: string }) {
  const commits = useGitPanelStore((s) => s.commits)
  const branches = useGitPanelStore((s) => s.branches)
  const selected = useGitPanelStore((s) => s.selectedCommitSha)
  const select = useGitPanelStore((s) => s.selectCommit)

  const graph = useMemo(() => (commits && commits.length > 0 ? layout(commits) : null), [commits])
  const remoteNames = useMemo(
    () => new Set((branches ?? []).filter(b => b.isRemote).map(b => b.name)),
    [branches],
  )

  if (!commits || commits.length === 0) {
    return <div className="p-4 text-sm opacity-70">Aucun commit.</div>
  }
  if (!graph) return null

  const svgWidth = LEFT_PAD * 2 + graph.columns * TRACK_WIDTH
  const svgHeight = graph.nodes.length * ROW_HEIGHT

  return (
    <div className="h-full overflow-auto">
      <div className="relative" style={{ minHeight: svgHeight }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          role="img"
          aria-label={`Git graph, ${commits.length} commits`}
          className="absolute left-0 top-0 pointer-events-none"
        >
          <defs>
            <marker
              id="arrow-merge"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {graph.edges.map((e, i) => (
            <g key={i} style={{ color: e.color }}>
              <path
                d={pathFor(e)}
                stroke="currentColor"
                strokeWidth={3}
                fill="none"
                strokeLinecap="round"
                markerEnd={e.kind === 'merge' ? 'url(#arrow-merge)' : undefined}
              />
            </g>
          ))}
          {graph.nodes.map((n) => {
            const cx = LEFT_PAD + n.x * TRACK_WIDTH
            const cy = n.y * ROW_HEIGHT + ROW_HEIGHT / 2
            const isSelected = selected === n.commit.sha
            return (
              <g key={n.commit.sha}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={NODE_RADIUS}
                  fill={n.color}
                  stroke={isSelected ? 'var(--color-text)' : 'none'}
                  strokeWidth={isSelected ? 2 : 0}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={INNER_RADIUS}
                  fill="var(--color-bg)"
                />
              </g>
            )
          })}
        </svg>

        <ul className="relative" style={{ paddingLeft: svgWidth }}>
          {graph.nodes.map((n) => {
            const isSelected = selected === n.commit.sha
            const badges = n.commit.refs.map(r => classifyRef(r, remoteNames))
            return (
              <li key={n.commit.sha} style={{ height: ROW_HEIGHT }}>
                <button
                  aria-label={n.commit.shortSha}
                  onClick={() => select(cwd, n.commit.sha)}
                  style={{ height: ROW_HEIGHT }}
                  className={`flex items-center gap-2 w-full pr-3 pl-1 text-left hover:bg-[color:color-mix(in_srgb,var(--color-text)_10%,transparent)] ${
                    isSelected ? 'bg-[color:color-mix(in_srgb,var(--color-accent)_15%,transparent)]' : ''
                  }`}
                >
                  {badges.map((b, i) => (
                    <span
                      key={i}
                      className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${refClasses(b.kind)}`}
                    >
                      {b.label}
                    </span>
                  ))}
                  <span className="truncate flex-1 text-xs">{n.commit.subject}</span>
                  <span className="font-mono text-[10px] opacity-60 shrink-0">{n.commit.shortSha}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
