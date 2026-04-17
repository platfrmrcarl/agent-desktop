/**
 * Parse a raw font-scale string into a numeric multiplier.
 *
 * Handles legacy-px storage (values > 4 are treated as pixels on a 16px UA
 * base) so the DB setting does not need a schema migration.
 */
export function parseFontScale(raw: string | undefined): number {
  if (!raw) return 1
  const n = parseFloat(raw)
  if (isNaN(n) || n <= 0) return 1
  // values ≤ 4 are treated as a scale factor (max sane scale ~3); > 4 signals legacy px
  if (n > 4) return Math.round((n / 16) * 100) / 100
  return n
}

/**
 * Write the scale factor to the --font-scale CSS variable on <html>.
 */
export function applyFontScale(raw: string | undefined): void {
  if (typeof document === 'undefined') return
  const scale = parseFontScale(raw)
  document.documentElement.style.setProperty('--font-scale', String(scale))
}

/**
 * Convert a positive px number to a rem string on the 16px base.
 */
export function pxToRem(px: number): string {
  return `${px / 16}rem`
}
