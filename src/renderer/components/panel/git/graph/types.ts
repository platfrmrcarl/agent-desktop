import type { GitCommit } from '@shared/git-types'

export interface GraphNode {
  commit: GitCommit
  x: number
  y: number
  color: string
}

export interface GraphEdge {
  from: GraphNode
  to: GraphNode
  kind: 'direct' | 'merge'
  color: string
}

export interface GraphLayout {
  nodes: GraphNode[]
  edges: GraphEdge[]
  columns: number
}
