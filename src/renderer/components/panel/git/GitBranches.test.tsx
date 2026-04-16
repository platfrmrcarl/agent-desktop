import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitBranches } from './GitBranches'
import { useGitPanelStore } from '../../../stores/gitPanelStore'

beforeEach(() => {
  useGitPanelStore.getState().reset()
  useGitPanelStore.setState({
    branches: [
      { name: 'main', isCurrent: true, isRemote: false, upstream: 'origin/main', ahead: 0, behind: 0, lastCommitSha: 'abc', lastCommitSubject: 'x', lastCommitDate: '2026-04-10T00:00:00+00:00' },
      { name: 'feature', isCurrent: false, isRemote: false, upstream: null, ahead: null, behind: null, lastCommitSha: 'def', lastCommitSubject: 'y', lastCommitDate: '2026-04-09T00:00:00+00:00' },
    ],
  })
  // @ts-expect-error test-only
  globalThis.window = globalThis.window ?? {}
  ;(globalThis.window as any).agent = { git: {
    checkout: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ branch: 'main', clean: true, ahead: 0, behind: 0, upstream: null, detached: false, files: [] })),
    logGraph: vi.fn(async () => []),
    branches: vi.fn(async () => []),
    stashList: vi.fn(async () => []),
  } }
})

describe('GitBranches', () => {
  it('lists branches with current marker', () => {
    render(<GitBranches cwd="/tmp" />)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('feature')).toBeInTheDocument()
  })

  it('clicking a non-current branch calls checkout', () => {
    render(<GitBranches cwd="/tmp" />)
    fireEvent.click(screen.getByRole('button', { name: /feature/ }))
    expect((globalThis.window as any).agent.git.checkout).toHaveBeenCalledWith('/tmp', 'feature')
  })

  it('current branch button is disabled', () => {
    render(<GitBranches cwd="/tmp" />)
    expect(screen.getByRole('button', { name: /main/ })).toBeDisabled()
  })
})
