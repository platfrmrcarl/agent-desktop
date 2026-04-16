import { runGit } from './spawn'
import { GitOperationError } from '@shared/git-types'

export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  const verify = await runGit(cwd, ['rev-parse', '--verify', `refs/heads/${name}`], { throwOnNonZero: false })
  if (verify.code !== 0) {
    throw new GitOperationError({ kind: 'not-found', target: name })
  }
  await runGit(cwd, ['checkout', name])
}

export async function fetch(cwd: string, remote?: string): Promise<void> {
  const args = ['fetch']
  if (remote) args.push(remote)
  await runGit(cwd, args, { timeoutMs: 30_000 })
}
