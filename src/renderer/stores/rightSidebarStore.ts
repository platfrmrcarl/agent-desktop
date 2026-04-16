import { create } from 'zustand'

export type RightSidebarTab = 'preview' | 'git'

interface RightSidebarState {
  activeTab: RightSidebarTab
  setActiveTab: (tab: RightSidebarTab) => void
}

export const useRightSidebarStore = create<RightSidebarState>((set) => ({
  activeTab: 'preview',
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
