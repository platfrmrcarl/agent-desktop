import { act } from '@testing-library/react'
import { mockAgent } from '../__tests__/setup'
import { useModelsStore } from './modelsStore'

describe('modelsStore', () => {
  beforeEach(() => {
    act(() => {
      useModelsStore.setState({
        models: [],
        isLoading: false,
        hasFetched: false,
      })
    })
    mockAgent.models = {
      list: vi.fn().mockResolvedValue([{ value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }]),
      refresh: vi.fn().mockResolvedValue([{ value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }]),
    }
  })

  it('fetches models for the requested backend', async () => {
    await act(async () => {
      await useModelsStore.getState().fetch('pi')
    })

    expect(mockAgent.models.list).toHaveBeenCalledWith('pi')
    expect(useModelsStore.getState().models).toEqual([{ value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }])
  })

  it('refreshes models for the requested backend', async () => {
    await act(async () => {
      await useModelsStore.getState().refresh('claude-agent-sdk')
    })

    expect(mockAgent.models.refresh).toHaveBeenCalledWith('claude-agent-sdk')
  })
})
