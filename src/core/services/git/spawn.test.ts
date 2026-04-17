import { describe, expect, it } from 'vitest'
import { runGit } from './spawn'
import { GitOperationError } from '@shared/git-types'

describe('runGit', () => {
  it('returns stdout/code on success', async () => {
    const res = await runGit(process.cwd(), ['--version'])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/^git version /)
  })

  it('captures stderr on non-zero exit without throwing (throwOnNonZero=false)', async () => {
    const res = await runGit(process.cwd(), ['nonsense-subcommand'], { throwOnNonZero: false })
    expect(res.code).not.toBe(0)
    expect(res.stderr.length).toBeGreaterThan(0)
  })

  it('throws GitOperationError exec-failed when throwOnNonZero=true and exit != 0', async () => {
    await expect(runGit(process.cwd(), ['nonsense-subcommand'])).rejects.toBeInstanceOf(GitOperationError)
  })

  it('throws GitOperationError timeout when command exceeds timeoutMs', async () => {
    // hash-object --stdin blocks until stdin closes — guarantees the timer wins the race,
    // unlike fast-completing reads (e.g. `log -n 1`) which can flake under load.
    const promise = runGit(process.cwd(), ['hash-object', '--stdin'], { timeoutMs: 10 })
    await expect(promise).rejects.toBeInstanceOf(GitOperationError)
  })

  it('forces GIT_TERMINAL_PROMPT=0 in env', async () => {
    const res = await runGit(process.cwd(), ['--version'], { captureEnv: true })
    expect(res.envUsed?.GIT_TERMINAL_PROMPT).toBe('0')
  })
})
