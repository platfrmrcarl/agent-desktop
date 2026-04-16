import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseStatusPorcelainV2,
  parseLogFormat,
  parseBranchList,
  parseStashList,
} from './parsers'

const FIXTURES = join(__dirname, '__fixtures__')
const read = (name: string) => fs.readFile(join(FIXTURES, name), 'utf8')

describe('parseStatusPorcelainV2', () => {
  it('parses clean repo', async () => {
    const r = parseStatusPorcelainV2(await read('status-clean.txt'))
    expect(r).toEqual({
      branch: 'master',
      upstream: 'origin/master',
      ahead: 0,
      behind: 0,
      detached: false,
      files: [],
      clean: true,
    })
  })

  it('parses modified + staged + untracked', async () => {
    const r = parseStatusPorcelainV2(await read('status-modified-staged.txt'))
    expect(r.ahead).toBe(2)
    expect(r.behind).toBe(1)
    expect(r.files).toHaveLength(3)
    expect(r.files[0]).toEqual({ path: 'src/index.ts', index: 'M', worktree: '.' })
    expect(r.files[1]).toEqual({ path: 'src/app.ts', index: '.', worktree: 'M' })
    expect(r.files[2]).toEqual({ path: 'README.md', index: '?', worktree: '?' })
    expect(r.clean).toBe(false)
  })

  it('parses detached HEAD', async () => {
    const r = parseStatusPorcelainV2(await read('status-detached.txt'))
    expect(r.branch).toBeNull()
    expect(r.detached).toBe(true)
  })

  it('parses renames with original path', async () => {
    const r = parseStatusPorcelainV2(await read('status-rename.txt'))
    expect(r.files[0]).toEqual({
      path: 'src/new.ts',
      index: 'R',
      worktree: '.',
      renamedFrom: 'src/old.ts',
    })
  })
})

describe('parseLogFormat', () => {
  const NUL = '\x00'
  const RS = '\x1e'

  const build = (rows: Array<[sha: string, parents: string, subject: string, an: string, ae: string, date: string, refs: string]>) =>
    rows.map(r => r.join(NUL)).join(RS) + RS

  it('parses linear log', () => {
    const raw = build([
      ['ccc', 'bbb', 'third', 'Alice', 'a@x', '2026-04-10T12:00:00+00:00', 'HEAD -> master'],
      ['bbb', 'aaa', 'second', 'Alice', 'a@x', '2026-04-09T12:00:00+00:00', ''],
      ['aaa', '', 'first', 'Alice', 'a@x', '2026-04-08T12:00:00+00:00', 'tag: v0'],
    ])
    const commits = parseLogFormat(raw)
    expect(commits).toHaveLength(3)
    expect(commits[0].sha).toBe('ccc')
    expect(commits[0].parents).toEqual(['bbb'])
    expect(commits[0].refs).toEqual(['HEAD -> master'])
    expect(commits[2].parents).toEqual([])
    expect(commits[2].refs).toEqual(['tag: v0'])
  })

  it('parses merge commit with two parents', () => {
    const raw = build([
      ['ddd', 'ccc aaa', 'merge', 'Alice', 'a@x', '2026-04-11T12:00:00+00:00', 'HEAD -> master'],
    ])
    const commits = parseLogFormat(raw)
    expect(commits[0].parents).toEqual(['ccc', 'aaa'])
  })

  it('splits multiple refs separated by comma', () => {
    const raw = build([
      ['ccc', '', 'x', 'A', 'a@x', '2026-04-10T12:00:00+00:00', 'HEAD -> master, origin/master, tag: v1'],
    ])
    const commits = parseLogFormat(raw)
    expect(commits[0].refs).toEqual(['HEAD -> master', 'origin/master', 'tag: v1'])
  })

  it('derives shortSha as 7 chars', () => {
    const raw = build([
      ['abcdef1234567890abcdef1234567890abcdef12', '', 'x', 'A', 'a@x', '2026-04-10T12:00:00+00:00', ''],
    ])
    expect(parseLogFormat(raw)[0].shortSha).toBe('abcdef1')
  })
})

describe('parseBranchList', () => {
  const NUL = '\x00'
  const row = (name: string, upstream: string, track: string, sha: string, subj: string, date: string, head: '*' | ' ') =>
    [name, upstream, track, sha, subj, date, head].join(NUL)

  it('returns empty array for empty input', () => {
    expect(parseBranchList('')).toEqual([])
  })

  it('parses local and remote branches with tracking', () => {
    const raw = [
      row('master', 'origin/master', '[ahead 1, behind 2]', 'abc', 'Master tip', '2026-04-10T12:00:00+00:00', '*'),
      row('feature/x', '', '', 'def', 'Feature tip', '2026-04-09T12:00:00+00:00', ' '),
      row('origin/master', '', '', 'bbb', 'Origin tip', '2026-04-09T12:00:00+00:00', ' '),
    ].join('\n')
    const branches = parseBranchList(raw)
    expect(branches).toHaveLength(3)
    expect(branches[0]).toMatchObject({ name: 'master', isCurrent: true, isRemote: false, upstream: 'origin/master', ahead: 1, behind: 2 })
    expect(branches[1]).toMatchObject({ name: 'feature/x', isCurrent: false, isRemote: false, upstream: null, ahead: null, behind: null })
    expect(branches[2]).toMatchObject({ name: 'origin/master', isCurrent: false, isRemote: true })
  })
})

describe('parseStashList', () => {
  const NUL = '\x00'
  it('parses multiple stash entries', () => {
    const raw = [
      ['stash@{0}', 'On master: WIP commit', '2026-04-10T12:00:00+00:00'].join(NUL),
      ['stash@{1}', 'On feature: WIP', '2026-04-09T12:00:00+00:00'].join(NUL),
    ].join('\n')
    const stashes = parseStashList(raw)
    expect(stashes).toHaveLength(2)
    expect(stashes[0]).toEqual({
      index: 0,
      message: 'On master: WIP commit',
      branch: 'master',
      date: '2026-04-10T12:00:00+00:00',
    })
    expect(stashes[1].index).toBe(1)
    expect(stashes[1].branch).toBe('feature')
  })

  it('returns empty array for empty input', () => {
    expect(parseStashList('')).toEqual([])
  })
})
