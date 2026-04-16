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
  fetch: () => Promise<void>
  refresh: () => Promise<void>
}

const STATIC_FALLBACK: ModelOption[] = MODEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))

export const useModelsStore = create<ModelsState>((set, get) => ({
  models: STATIC_FALLBACK,
  isLoading: false,
  hasFetched: false,

  fetch: async () => {
    if (get().hasFetched || get().isLoading) return
    set({ isLoading: true })
    try {
      const list = await window.agent.models.list()
      if (Array.isArray(list) && list.length > 0) {
        set({ models: list, hasFetched: true, isLoading: false })
      } else {
        set({ hasFetched: true, isLoading: false })
      }
    } catch {
      set({ isLoading: false, hasFetched: true })
    }
  },

  refresh: async () => {
    set({ isLoading: true })
    try {
      const list = await window.agent.models.refresh()
      if (Array.isArray(list) && list.length > 0) {
        set({ models: list, hasFetched: true, isLoading: false })
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },
}))
