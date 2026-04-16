const PALETTE = [
  'var(--accent)',
  'var(--accent-2, var(--accent))',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--info, var(--accent))',
]

export function pickTrackColor(trackIndex: number): string {
  return PALETTE[trackIndex % PALETTE.length]
}
