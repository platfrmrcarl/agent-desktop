import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { join } from 'node:path'
import { isGitRepo } from './repo'
import { getStatus } from './status'
import { getLogGraph, getCommitDetail } from './log'
import { runGit } from './spawn'

async function mkRepo(): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'agent-git-test-'))
  await runGit(dir, ['init', '-b', 'main'])
  await runGit(dir, ['config', 'user.email', 'test@test'])
  await runGit(dir, ['config', 'user.name', 'Test'])
  await runGit(dir, ['commit', '--allow-empty', '-m', 'initial'])
  return dir
}

let tmpDir: string

beforeEach(async () => { tmpDir = await mkRepo() })
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }) })

describe('isGitRepo', () => {
  it('returns true inside a repo', async () => {
    expect(await isGitRepo(tmpDir)).toBe(true)
  })
  it('returns false outside a repo', async () => {
    expect(await isGitRepo(os.tmpdir())).toBe(false)
  })
  it('returns false for null cwd', async () => {
    expect(await isGitRepo(null)).toBe(false)
  })
})

describe('getStatus', () => {
  it('reports clean repo', async () => {
    const s = await getStatus(tmpDir)
    expect(s.clean).toBe(true)
    expect(s.branch).toBe('main')
  })
  it('reports modified file after edit', async () => {
    await fs.writeFile(join(tmpDir, 'a.txt'), 'hello')
    const s = await getStatus(tmpDir)
    expect(s.files.some(f => f.path === 'a.txt' && f.worktree === '?')).toBe(true)
  })
  it('reports staged file after add', async () => {
    await fs.writeFile(join(tmpDir, 'a.txt'), 'hello')
    await runGit(tmpDir, ['add', 'a.txt'])
    const s = await getStatus(tmpDir)
    expect(s.files.some(f => f.path === 'a.txt' && f.index === 'A')).toBe(true)
  })
})

describe('getLogGraph', () => {
  it('returns the initial commit', async () => {
    const commits = await getLogGraph(tmpDir, { limit: 10 })
    expect(commits).toHaveLength(1)
    expect(commits[0].subject).toBe('initial')
    expect(commits[0].parents).toEqual([])
  })

  it('returns parents for a merge commit', async () => {
    await runGit(tmpDir, ['checkout', '-b', 'feature'])
    await fs.writeFile(join(tmpDir, 'f.txt'), 'x')
    await runGit(tmpDir, ['add', 'f.txt'])
    await runGit(tmpDir, ['commit', '-m', 'feature change'])
    await runGit(tmpDir, ['checkout', 'main'])
    await fs.writeFile(join(tmpDir, 'm.txt'), 'x')
    await runGit(tmpDir, ['add', 'm.txt'])
    await runGit(tmpDir, ['commit', '-m', 'main change'])
    await runGit(tmpDir, ['merge', 'feature', '--no-ff', '-m', 'merge feature'])
    const commits = await getLogGraph(tmpDir, { limit: 10 })
    const merge = commits.find(c => c.subject === 'merge feature')!
    expect(merge.parents).toHaveLength(2)
  })
})

describe('getCommitDetail', () => {
  it('returns body and changed files', async () => {
    await fs.writeFile(join(tmpDir, 'a.txt'), 'content')
    await runGit(tmpDir, ['add', 'a.txt'])
    await runGit(tmpDir, ['commit', '-m', 'Subject line', '-m', 'Body line 1\nBody line 2'])
    const { stdout } = await runGit(tmpDir, ['rev-parse', 'HEAD'])
    const sha = stdout.trim()
    const detail = await getCommitDetail(tmpDir, sha)
    expect(detail.body).toContain('Body line 1')
    expect(detail.files).toEqual([{ path: 'a.txt', status: 'A' }])
  })
})
