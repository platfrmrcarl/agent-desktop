import { runGit } from './spawn'
import { parseBranchList, BRANCH_FORMAT } from './parsers'
import type { GitBranch } from '@shared/git-types'

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  const { stdout } = await runGit(cwd, [
    'for-each-ref',
    `--format=${BRANCH_FORMAT}`,
    'refs/heads',
    'refs/remotes',
  ])
  return parseBranchList(stdout)
}
