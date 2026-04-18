import { describe, it, expect, beforeEach } from 'vitest'
import { useBugReportStore } from './bugReportStore'

beforeEach(() => {
  useBugReportStore.setState({ isOpen: false, prefillDescription: '', lastSentAtMs: 0 })
})

describe('bugReportStore', () => {
  it('open() sets isOpen=true', () => {
    useBugReportStore.getState().open()
    expect(useBugReportStore.getState().isOpen).toBe(true)
  })

  it('open() accepts prefillDescription', () => {
    useBugReportStore.getState().open({ prefillDescription: 'crash at X' })
    expect(useBugReportStore.getState().prefillDescription).toBe('crash at X')
  })

  it('close() resets state', () => {
    useBugReportStore.getState().open({ prefillDescription: 'x' })
    useBugReportStore.getState().close()
    const s = useBugReportStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.prefillDescription).toBe('')
  })

  it('markSent() records timestamp', () => {
    useBugReportStore.getState().markSent()
    expect(useBugReportStore.getState().lastSentAtMs).toBeGreaterThan(0)
  })
})
