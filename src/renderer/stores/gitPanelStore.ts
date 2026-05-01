import { create } from 'zustand'
import type {
  GitStatus, GitCommit, GitBranch, GitStashEntry, GitError, GitCommitFile,
} from '@shared/git-types'

type GitSubTab = 'graph' | 'status' | 'branches' | 'stash'

interface Loading { status: boolean; log: boolean; branches: boolean; stash: boolean }
interface Errors {
  status: GitError | null
  log: GitError | null
  branches: GitError | null
  stash: GitError | null
  action: GitError | null
}

interface GitPanelState {
  activeSubTab: GitSubTab
  status: GitStatus | null
  commits: GitCommit[] | null
  branches: GitBranch[] | null
  stashes: GitStashEntry[] | null
  selectedCommitSha: string | null
  commitDetail: { sha: string; body: string; files: GitCommitFile[] } | null
  bodyCache: Record<string, string>
  loading: Loading
  errors: Errors
  lastRefreshAt: number

  setActiveSubTab: (tab: GitSubTab) => void
  refresh: (cwd: string) => Promise<void>
  selectCommit: (cwd: string, sha: string) => Promise<void>
  prefetchCommitBody: (cwd: string, sha: string) => Promise<void>
  checkout: (cwd: string, name: string) => Promise<void>
  stashSave: (cwd: string, message?: string) => Promise<void>
  stashPop: (cwd: string, index: number) => Promise<void>
  fetch: (cwd: string, remote?: string) => Promise<void>
  reset: () => void
}

const INIT: Omit<GitPanelState, 'setActiveSubTab' | 'refresh' | 'selectCommit' | 'prefetchCommitBody' | 'checkout' | 'stashSave' | 'stashPop' | 'fetch' | 'reset'> = {
  activeSubTab: 'graph' as GitSubTab,
  status: null,
  commits: null,
  branches: null,
  stashes: null,
  selectedCommitSha: null,
  commitDetail: null,
  bodyCache: {},
  loading: { status: false, log: false, branches: false, stash: false },
  errors: { status: null, log: null, branches: null, stash: null, action: null },
  lastRefreshAt: 0,
}

function toGitError(e: unknown): GitError {
  if (e && typeof e === 'object' && 'kind' in (e as object)) return e as GitError
  const err = e as { error?: GitError }
  if (err?.error && typeof err.error === 'object' && 'kind' in err.error) return err.error
  return { kind: 'exec-failed', cmd: [], code: -1, stderr: String(e) }
}

export const useGitPanelStore = create<GitPanelState>((set, get) => ({
  ...INIT,

  setActiveSubTab: (tab) => set({ activeSubTab: tab }),

  refresh: async (cwd) => {
    set({ loading: { status: true, log: true, branches: true, stash: true } })
    const api = window.agent.git
    const results = await Promise.allSettled([
      api.status(cwd),
      api.logGraph(cwd, { limit: 500 }),
      api.branches(cwd),
      api.stashList(cwd),
    ])
    const [st, lg, br, sh] = results
    set({
      status: st.status === 'fulfilled' ? st.value : get().status,
      commits: lg.status === 'fulfilled' ? lg.value : get().commits,
      branches: br.status === 'fulfilled' ? br.value : get().branches,
      stashes: sh.status === 'fulfilled' ? sh.value : get().stashes,
      errors: {
        status: st.status === 'rejected' ? toGitError(st.reason) : null,
        log: lg.status === 'rejected' ? toGitError(lg.reason) : null,
        branches: br.status === 'rejected' ? toGitError(br.reason) : null,
        stash: sh.status === 'rejected' ? toGitError(sh.reason) : null,
        action: get().errors.action,
      },
      loading: { status: false, log: false, branches: false, stash: false },
      lastRefreshAt: Date.now(),
    })
  },

  selectCommit: async (cwd, sha) => {
    set({ selectedCommitSha: sha, commitDetail: null })
    try {
      const d = await window.agent.git.commitDetail(cwd, sha)
      set({
        commitDetail: { sha, body: d.body, files: d.files },
        bodyCache: { ...get().bodyCache, [sha]: d.body },
      })
    } catch (e) {
      set({ errors: { ...get().errors, action: toGitError(e) } })
    }
  },

  prefetchCommitBody: async (cwd, sha) => {
    if (get().bodyCache[sha] !== undefined) return
    try {
      const d = await window.agent.git.commitDetail(cwd, sha)
      set({ bodyCache: { ...get().bodyCache, [sha]: d.body } })
    } catch {
      // Silent: prefetch is best-effort, don't pollute errors.action
    }
  },

  checkout: async (cwd, name) => {
    try {
      await window.agent.git.checkout(cwd, name)
      await get().refresh(cwd)
    } catch (e) {
      set({ errors: { ...get().errors, action: toGitError(e) } })
    }
  },

  stashSave: async (cwd, message) => {
    try {
      await window.agent.git.stashSave(cwd, message)
      await get().refresh(cwd)
    } catch (e) {
      set({ errors: { ...get().errors, action: toGitError(e) } })
    }
  },

  stashPop: async (cwd, index) => {
    try {
      await window.agent.git.stashPop(cwd, index)
      await get().refresh(cwd)
    } catch (e) {
      set({ errors: { ...get().errors, action: toGitError(e) } })
    }
  },

  fetch: async (cwd, remote) => {
    try {
      await window.agent.git.fetch(cwd, remote)
      await get().refresh(cwd)
    } catch (e) {
      set({ errors: { ...get().errors, action: toGitError(e) } })
    }
  },

  reset: () => set(INIT),
}))
