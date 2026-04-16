import { runGit } from './spawn'
import { parseStatusPorcelainV2 } from './parsers'
import type { GitStatus } from '@shared/git-types'

export async function getStatus(cwd: string): Promise<GitStatus> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain=v2', '--branch'])
  return parseStatusPorcelainV2(stdout)
}
