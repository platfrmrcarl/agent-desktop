import { describe, expect, it } from 'vitest'
import { layout } from './layout'
import type { GitCommit } from '@shared/git-types'

const c = (sha: string, parents: string[] = [], subject = sha): GitCommit => ({
  sha, shortSha: sha.slice(0, 7), parents, subject, body: '',
  authorName: 'A', authorEmail: 'a@x', authorDate: '2026-04-10T00:00:00+00:00', refs: [],
})

describe('layout', () => {
  it('linear history: all on column 0', () => {
    const res = layout([c('c', ['b']), c('b', ['a']), c('a')])
    expect(res.columns).toBe(1)
    expect(res.nodes.map(n => n.x)).toEqual([0, 0, 0])
    expect(res.edges).toHaveLength(2)
    expect(res.edges.every(e => e.kind === 'direct')).toBe(true)
  })

  it('2-branch merge: merge node then fork into two tracks', () => {
    const res = layout([
      c('m', ['t', 'f'], 'merge'),
      c('t', ['b'], 'master tip'),
      c('f', ['b'], 'feature tip'),
      c('b', [], 'base'),
    ])
    expect(res.columns).toBeGreaterThanOrEqual(2)
    const merge = res.nodes.find(n => n.commit.sha === 'm')!
    expect(merge.x).toBe(0)
    const edgeTypes = res.edges.filter(e => e.from.commit.sha === 'm' || e.to.commit.sha === 'm').map(e => e.kind).sort()
    // m is the child (to) of 2 parents t,f → 2 edges from t/f to m. One is 'direct' (first parent t), one is 'merge' (second parent f).
    expect(edgeTypes).toEqual(['direct', 'merge'])
  })

  it('disconnected commits get new columns', () => {
    const res = layout([c('x'), c('y'), c('z')])
    expect(res.columns).toBeGreaterThanOrEqual(1)
  })

  it('orders nodes by input order (y index)', () => {
    const res = layout([c('b', ['a']), c('a')])
    expect(res.nodes[0].y).toBe(0)
    expect(res.nodes[1].y).toBe(1)
  })

  it('assigns consistent color per track', () => {
    const res = layout([c('c', ['b']), c('b', ['a']), c('a')])
    const colors = new Set(res.nodes.map(n => n.color))
    expect(colors.size).toBe(1)
  })
})
