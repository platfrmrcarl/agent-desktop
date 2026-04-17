import { useSettingsStore } from '../stores/settingsStore'
import { parseFontScale } from '../utils/fontScale'

/**
 * Reactive Monaco fontSize based on the --font-scale setting.
 * Returns Math.round(basePx * scale), recomputed on store changes.
 */
export function useMonacoFontSize(basePx: number): number {
  const scale = useSettingsStore((s) => parseFontScale(s.settings.fontSize))
  return Math.round(basePx * scale)
}
