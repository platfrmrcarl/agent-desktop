import { create } from 'zustand'
import { MODEL_OPTIONS } from '../../shared/constants'

export interface ModelOption {
  value: string
  label: string
}

interface ModelsState {
  models: ModelOption[]
  isLoading: boolean
  hasFetched: boolean
  backend: string | null
  fetch: (backend?: string) => Promise<void>
  refresh: (backend?: string) => Promise<void>
}

const STATIC_FALLBACK: ModelOption[] = MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: STATIC_FALLBACK,
  isLoading: false,
  hasFetched: false,
  backend: null,

  fetch: async (backend = 'claude-agent-sdk') => {
    if (get().backend === backend && get().hasFetched) return
    if (get().isLoading) return
    set({ isLoading: true })
    try {
      const list = await window.agent.models.list(backend)
      if (Array.isArray(list) && list.length > 0) {
        set({ models: list, hasFetched: true, isLoading: false, backend })
      } else {
        set({ hasFetched: true, isLoading: false, backend })
      }
    } catch {
      set({ isLoading: false, hasFetched: true, backend })
    }
  },

  refresh: async (backend = 'claude-agent-sdk') => {
    set({ isLoading: true })
    try {
      const list = await window.agent.models.refresh(backend)
      if (Array.isArray(list) && list.length > 0) {
        set({ models: list, hasFetched: true, isLoading: false, backend })
      } else {
        set({ isLoading: false, backend })
      }
    } catch {
      set({ isLoading: false, backend })
    }
  },
}))
