import { runGit } from './spawn'
import { parseLogFormat, LOG_FORMAT } from './parsers'
import type { GitCommit, GitCommitFile } from '@shared/git-types'

export interface LogGraphOptions {
  limit?: number
  branch?: string
}

export async function getLogGraph(cwd: string, opts: LogGraphOptions = {}): Promise<GitCommit[]> {
  const limit = opts.limit ?? 500
  const args = ['log', '--topo-order', `--max-count=${limit}`, `--pretty=format:${LOG_FORMAT}`]
  if (opts.branch) args.push(opts.branch)
  else args.push('--all')
  const { stdout } = await runGit(cwd, args)
  return parseLogFormat(stdout)
}

export async function getCommitDetail(cwd: string, sha: string): Promise<{ body: string; files: GitCommitFile[] }> {
  const { stdout: bodyOut } = await runGit(cwd, ['log', '-1', '--pretty=format:%b', sha])
  const { stdout: nameStatus } = await runGit(cwd, ['show', '--name-status', '--pretty=format:', sha])
  const files: GitCommitFile[] = nameStatus
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const parts = line.split('\t')
      const code = parts[0]
      if (code.startsWith('R') || code.startsWith('C')) {
        return {
          path: parts[2],
          status: code[0] as GitCommitFile['status'],
          renamedFrom: parts[1],
        }
      }
      return { path: parts[1], status: code[0] as GitCommitFile['status'] }
    })
  return { body: bodyOut, files }
}
