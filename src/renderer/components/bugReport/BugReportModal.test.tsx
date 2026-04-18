import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BugReportModal } from './BugReportModal'
import { useBugReportStore } from '../../stores/bugReportStore'
import { rendererErrorBuffer } from '../../bootstrap/rendererErrorCapture'

const agentMock = {
  bugReport: {
    getMainErrors: vi.fn(),
    scrub: vi.fn((s: string) => Promise.resolve(s)),
    send: vi.fn(),
  },
}
;(global as unknown as { window: { agent: unknown } }).window.agent = agentMock

beforeEach(() => {
  useBugReportStore.setState({ isOpen: true, prefillDescription: '', lastSentAtMs: 0 })
  rendererErrorBuffer.clear()
  agentMock.bugReport.getMainErrors.mockReset().mockResolvedValue([])
  agentMock.bugReport.scrub.mockReset().mockImplementation((s: string) => Promise.resolve(s))
  agentMock.bugReport.send.mockReset().mockResolvedValue({ ok: true })
})

describe('BugReportModal', () => {
  it('loads and displays scrubbed logs on mount', async () => {
    agentMock.bugReport.getMainErrors.mockResolvedValue([
      { timestamp: '2026-04-18T10:00:00.000Z', source: 'main', level: 'error', message: 'boom' },
    ])
    render(<BugReportModal />)
    await waitFor(() => {
      const ta = screen.getByTestId('bug-logs-textarea') as HTMLTextAreaElement
      expect(ta.value).toContain('boom')
    })
  })

  it('disables Send when both description and logs are empty', async () => {
    render(<BugReportModal />)
    await waitFor(() => {
      expect(screen.getByTestId('bug-send-button')).toBeDisabled()
    })
  })

  it('enables Send when description has text', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), {
      target: { value: 'crash' },
    })
    expect(screen.getByTestId('bug-send-button')).not.toBeDisabled()
  })

  it('calls window.agent.bugReport.send on Send click', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), {
      target: { value: 'crash' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('bug-send-button'))
    })
    expect(agentMock.bugReport.send).toHaveBeenCalledWith({
      description: 'crash',
      logs: expect.any(String),
    })
  })

  it('shows rate-limit countdown when send returns rate_limited', async () => {
    agentMock.bugReport.send.mockResolvedValue({ ok: false, error: 'rate_limited', retryAfterMs: 12000 })
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('bug-send-button'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('bug-send-button')).toHaveTextContent(/12s/)
    })
  })

  it('closes modal on Cancel', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-cancel-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('bug-cancel-button'))
    expect(useBugReportStore.getState().isOpen).toBe(false)
  })

  it('does not set logs state when modal closes before getMainErrors resolves', async () => {
    let resolveFn: (v: unknown) => void = () => {}
    agentMock.bugReport.getMainErrors.mockImplementation(
      () => new Promise((resolve) => { resolveFn = resolve }),
    )
    const { unmount } = render(<BugReportModal />)
    // Close before the promise resolves
    useBugReportStore.getState().close()
    // Now resolve the promise with data
    resolveFn([
      { timestamp: '2026-04-18T10:00:00.000Z', source: 'main', level: 'error', message: 'late' },
    ])
    // Wait a tick to let any .then handlers fire
    await new Promise((r) => setTimeout(r, 0))
    // After close, modal is null — no textarea to query
    expect(screen.queryByTestId('bug-logs-textarea')).toBeNull()
    unmount()
  })
})
