import { create } from 'zustand'

interface BugReportState {
  isOpen: boolean
  prefillDescription: string
  lastSentAtMs: number
  open: (opts?: { prefillDescription?: string }) => void
  close: () => void
  markSent: () => void
}

export const useBugReportStore = create<BugReportState>((set) => ({
  isOpen: false,
  prefillDescription: '',
  lastSentAtMs: 0,
  open: (opts) =>
    set({
      isOpen: true,
      prefillDescription: opts?.prefillDescription ?? '',
    }),
  close: () =>
    set({
      isOpen: false,
      prefillDescription: '',
    }),
  markSent: () => set({ lastSentAtMs: Date.now() }),
}))
