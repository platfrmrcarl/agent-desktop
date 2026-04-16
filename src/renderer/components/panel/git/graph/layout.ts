import type { GitCommit } from '@shared/git-types'
import type { GraphLayout, GraphNode, GraphEdge } from './types'
import { pickTrackColor } from './colors'

interface PendingEdge {
  childSha: string
  parentSha: string
  kind: 'direct' | 'merge'
  color: string
}

export function layout(commits: GitCommit[]): GraphLayout {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const activeTracks: (string | null)[] = []
  const nodesBySha = new Map<string, GraphNode>()
  const pending: PendingEdge[] = []
  let maxCols = 0

  const allocFreeTrack = (): number => {
    for (let i = 0; i < activeTracks.length; i++) {
      if (activeTracks[i] === null) return i
    }
    activeTracks.push(null)
    return activeTracks.length - 1
  }

  commits.forEach((commit, y) => {
    let col = activeTracks.findIndex(s => s === commit.sha)
    if (col === -1) col = allocFreeTrack()
    const color = pickTrackColor(col)
    const node: GraphNode = { commit, x: col, y, color }
    nodes.push(node)
    nodesBySha.set(commit.sha, node)
    activeTracks[col] = null

    commit.parents.forEach((parentSha, pIdx) => {
      let parentCol: number
      if (pIdx === 0) {
        parentCol = col
      } else {
        const existing = activeTracks.findIndex(s => s === parentSha)
        parentCol = existing !== -1 ? existing : allocFreeTrack()
      }
      activeTracks[parentCol] = parentSha
      pending.push({
        childSha: commit.sha,
        parentSha,
        kind: pIdx === 0 ? 'direct' : 'merge',
        color: pickTrackColor(parentCol),
      })
    })

    if (activeTracks.length > maxCols) maxCols = activeTracks.length
  })

  for (const pe of pending) {
    const child = nodesBySha.get(pe.childSha)
    const parent = nodesBySha.get(pe.parentSha)
    if (!child || !parent) continue
    edges.push({ from: parent, to: child, kind: pe.kind, color: pe.color })
  }

  return { nodes, edges, columns: Math.max(maxCols, 1) }
}
