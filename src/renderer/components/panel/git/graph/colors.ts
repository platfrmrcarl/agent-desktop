const PALETTE = [
  'var(--color-accent)',
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-error)',
  'var(--color-tool)',
]

export function pickTrackColor(trackIndex: number): string {
  return PALETTE[trackIndex % PALETTE.length]
}
