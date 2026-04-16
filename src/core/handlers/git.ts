import type { HandleRegistrar } from '../dispatch'
import {
  isGitRepo, getStatus, getLogGraph, getCommitDetail,
  listBranches, listStash, stashSave, stashPop,
  checkoutBranch, gitFetch,
} from '../services/git'

export function registerGitHandlers(registrar: HandleRegistrar): void {
  registrar.handle('git:isRepo', async (_e, cwd: string | null) => isGitRepo(cwd))
  registrar.handle('git:status', async (_e, cwd: string) => getStatus(cwd))
  registrar.handle('git:logGraph', async (_e, cwd: string, opts?: { limit?: number; branch?: string }) => getLogGraph(cwd, opts ?? {}))
  registrar.handle('git:commitDetail', async (_e, cwd: string, sha: string) => getCommitDetail(cwd, sha))
  registrar.handle('git:branches', async (_e, cwd: string) => listBranches(cwd))
  registrar.handle('git:stashList', async (_e, cwd: string) => listStash(cwd))
  registrar.handle('git:checkout', async (_e, cwd: string, name: string) => checkoutBranch(cwd, name))
  registrar.handle('git:stashSave', async (_e, cwd: string, message?: string) => stashSave(cwd, message))
  registrar.handle('git:stashPop', async (_e, cwd: string, index: number) => stashPop(cwd, index))
  registrar.handle('git:fetch', async (_e, cwd: string, remote?: string) => gitFetch(cwd, remote))
}
