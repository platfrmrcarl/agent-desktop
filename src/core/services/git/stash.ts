import { runGit } from './spawn'
import { parseStashList, STASH_FORMAT } from './parsers'
import type { GitStashEntry } from '@shared/git-types'

export async function listStash(cwd: string): Promise<GitStashEntry[]> {
  const { stdout } = await runGit(cwd, ['stash', 'list', `--pretty=format:${STASH_FORMAT}`])
  return parseStashList(stdout)
}

export async function stashSave(cwd: string, message?: string): Promise<void> {
  const args = ['stash', 'push']
  if (message) args.push('-m', message)
  await runGit(cwd, args)
}

export async function stashPop(cwd: string, index: number): Promise<void> {
  await runGit(cwd, ['stash', 'pop', `stash@{${index}}`])
}
