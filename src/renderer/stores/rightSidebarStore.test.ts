import { describe, expect, it, beforeEach } from 'vitest'
import { useRightSidebarStore } from './rightSidebarStore'

beforeEach(() => {
  useRightSidebarStore.setState({ activeTab: 'preview' })
})

describe('rightSidebarStore', () => {
  it('defaults to preview tab', () => {
    expect(useRightSidebarStore.getState().activeTab).toBe('preview')
  })

  it('switches to git tab', () => {
    useRightSidebarStore.getState().setActiveTab('git')
    expect(useRightSidebarStore.getState().activeTab).toBe('git')
  })
})
