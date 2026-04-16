import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RightSidebarPanel } from './RightSidebarPanel'
import { useRightSidebarStore } from '../../stores/rightSidebarStore'
import * as cwdHook from '../../hooks/useActiveConversationCwd'

vi.mock('./PreviewTab', () => ({ PreviewTab: () => <div>PREVIEW</div> }))
vi.mock('./git', () => ({ GitTab: () => <div>GIT</div> }))
vi.mock('../../hooks/useActiveConversationCwd', () => ({
  useActiveConversationCwd: vi.fn(() => '/tmp/fake-a'),
}))

beforeEach(() => {
  useRightSidebarStore.setState({ activeTab: 'preview' })
  ;(globalThis.window as any).agent = {
    git: { isRepo: vi.fn(async () => true) },
  }
})

describe('RightSidebarPanel', () => {
  it('renders Preview tab by default', async () => {
    render(<RightSidebarPanel />)
    await waitFor(() => expect(screen.getByText('PREVIEW')).toBeInTheDocument())
  })

  it('switches to Git when Git tab clicked and repo detected', async () => {
    vi.mocked(cwdHook.useActiveConversationCwd).mockReturnValue('/tmp/fake-b')
    render(<RightSidebarPanel />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /git/i })).not.toHaveAttribute('aria-disabled', 'true')
    })
    fireEvent.click(screen.getByRole('tab', { name: /git/i }))
    expect(screen.getByText('GIT')).toBeInTheDocument()
  })

  it('disables Git tab when not a repo', async () => {
    vi.mocked(cwdHook.useActiveConversationCwd).mockReturnValue('/tmp/fake-c')
    ;(globalThis.window as any).agent.git.isRepo = vi.fn(async () => false)
    render(<RightSidebarPanel />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /git/i })).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
