/**
 * Returns a color-mix() string usable in inline style attributes.
 * Use instead of Tailwind opacity modifiers on CSS-var classes
 * (e.g. instead of `border-[var(--color-text)]/20`, use
 *  `style={{ borderColor: tint('--color-text', 20) }}`).
 */
export function tint(varName: string, alphaPercent: number): string {
  return `color-mix(in srgb, var(${varName}) ${alphaPercent}%, transparent)`
}
