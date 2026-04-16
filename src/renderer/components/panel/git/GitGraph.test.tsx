import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GitGraph } from './GitGraph'
import { useGitPanelStore } from '../../../stores/gitPanelStore'

beforeEach(() => {
  useGitPanelStore.getState().reset()
  useGitPanelStore.setState({
    commits: [
      {
        sha: 'abc1234567890abcdef0abcdef0abcdef0abcdef',
        shortSha: 'abc1234',
        parents: [],
        subject: 'first',
        body: '',
        authorName: 'A',
        authorEmail: 'a@x',
        authorDate: '2026-04-10T00:00:00+00:00',
        refs: ['HEAD -> main'],
      },
    ],
  })
  // @ts-expect-error test-only window stub
  globalThis.window = globalThis.window ?? {}
  ;(globalThis.window as any).agent = {
    git: { commitDetail: vi.fn(async () => ({ body: 'body', files: [] })) },
  }
})

describe('GitGraph', () => {
  it('renders one node per commit', () => {
    render(<GitGraph cwd="/tmp" />)
    expect(screen.getAllByRole('button', { name: /abc1234/ })).toHaveLength(1)
  })

  it('clicking a node selects it', () => {
    render(<GitGraph cwd="/tmp" />)
    fireEvent.click(screen.getByRole('button', { name: /abc1234/ }))
    expect(useGitPanelStore.getState().selectedCommitSha).toBe('abc1234567890abcdef0abcdef0abcdef0abcdef')
  })

  it('shows empty state when no commits', () => {
    useGitPanelStore.setState({ commits: [] })
    render(<GitGraph cwd="/tmp" />)
    expect(screen.getByText(/aucun commit/i)).toBeInTheDocument()
  })
})
