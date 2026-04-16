import { runGit } from './spawn'

export async function isGitRepo(cwd: string | null): Promise<boolean> {
  if (!cwd) return false
  try {
    const { code } = await runGit(cwd, ['rev-parse', '--git-dir'], {
      throwOnNonZero: false,
      timeoutMs: 2000,
    })
    return code === 0
  } catch {
    return false
  }
}
