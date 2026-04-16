import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useGitPanelStore } from './gitPanelStore'

beforeEach(() => {
  useGitPanelStore.getState().reset()
  // @ts-expect-error test-only window stub
  globalThis.window = globalThis.window ?? {}
  ;(globalThis.window as any).agent = {
    git: {
      status: vi.fn(async () => ({ branch: 'main', clean: true, ahead: 0, behind: 0, upstream: null, detached: false, files: [] })),
      logGraph: vi.fn(async () => []),
      branches: vi.fn(async () => []),
      stashList: vi.fn(async () => []),
      checkout: vi.fn(async () => undefined),
      stashSave: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      fetch: vi.fn(async () => undefined),
      commitDetail: vi.fn(async () => ({ body: '', files: [] })),
      isRepo: vi.fn(async () => true),
    },
  }
})

describe('gitPanelStore', () => {
  it('initial state has null data and false loading flags', () => {
    const s = useGitPanelStore.getState()
    expect(s.status).toBeNull()
    expect(s.commits).toBeNull()
    expect(Object.values(s.loading).every(v => v === false)).toBe(true)
    expect(s.activeSubTab).toBe('graph')
  })

  it('refresh populates all four datasets', async () => {
    await useGitPanelStore.getState().refresh('/tmp/fake')
    const s = useGitPanelStore.getState()
    expect(s.status).not.toBeNull()
    expect(s.commits).toEqual([])
    expect(s.branches).toEqual([])
    expect(s.stashes).toEqual([])
  })

  it('isolates errors per sub-dataset (allSettled)', async () => {
    ;(globalThis.window as any).agent.git.branches = vi.fn(async () => { throw { kind: 'exec-failed' } })
    await useGitPanelStore.getState().refresh('/tmp/fake')
    const s = useGitPanelStore.getState()
    expect(s.errors.branches).not.toBeNull()
    expect(s.errors.status).toBeNull()
    expect(s.status).not.toBeNull()
  })

  it('checkout calls IPC then refreshes', async () => {
    await useGitPanelStore.getState().checkout('/tmp/fake', 'feature')
    expect((globalThis.window as any).agent.git.checkout).toHaveBeenCalledWith('/tmp/fake', 'feature')
    expect((globalThis.window as any).agent.git.status).toHaveBeenCalled()
  })

  it('setActiveSubTab changes the sub-tab', () => {
    useGitPanelStore.getState().setActiveSubTab('branches')
    expect(useGitPanelStore.getState().activeSubTab).toBe('branches')
  })
})
