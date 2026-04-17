// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMonacoFontSize } from './useMonacoFontSize'
import { useSettingsStore } from '../stores/settingsStore'

describe('useMonacoFontSize', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {}, themes: [], activeTheme: null, isLoading: false })
  })

  it('returns the base size when scale is 1', () => {
    useSettingsStore.setState({ settings: { fontSize: '1' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
  })

  it('returns basePx * scale rounded', () => {
    useSettingsStore.setState({ settings: { fontSize: '1.5' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(20)
  })

  it('migrates legacy px values transparently', () => {
    useSettingsStore.setState({ settings: { fontSize: '20' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    // parseFontScale('20') = 1.25 -> 13 * 1.25 = 16.25 -> round = 16
    expect(result.current).toBe(16)
  })

  it('falls back to base when fontSize is unset', () => {
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
  })

  it('rerenders with new value when the store updates', () => {
    useSettingsStore.setState({ settings: { fontSize: '1' } })
    const { result } = renderHook(() => useMonacoFontSize(13))
    expect(result.current).toBe(13)
    act(() => {
      useSettingsStore.setState({ settings: { fontSize: '2' } })
    })
    expect(result.current).toBe(26)
  })
})
