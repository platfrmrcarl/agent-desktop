const ANSI_RE = /\x1b\[([0-9;]*)m/g

const COLORS_16 = [
  '#000000', '#cc0000', '#00cc00', '#cccc00', '#0000cc', '#cc00cc', '#00cccc', '#cccccc',
  '#555555', '#ff0000', '#00ff00', '#ffff00', '#5555ff', '#ff00ff', '#00ffff', '#ffffff',
]

// SGR codes that map to a fixed [property, value] pair.
const STYLE_FLAGS: Record<number, [string, string]> = {
  1: ['font-weight', 'bold'],
  2: ['opacity', '0.6'],
  3: ['font-style', 'italic'],
  4: ['text-decoration', 'underline'],
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function color256(n: number): string {
  if (n < 16) return COLORS_16[n]
  if (n >= 232) { const v = (n - 232) * 10 + 8; return `rgb(${v},${v},${v})` }
  const idx = n - 16
  const r = Math.floor(idx / 36) * 51
  const g = Math.floor((idx % 36) / 6) * 51
  const b = (idx % 6) * 51
  return `rgb(${r},${g},${b})`
}

// Resolve an SGR code in the standard color ranges to a [property, color] pair, or null.
function colorFromCode(c: number): [string, string] | null {
  if (c >= 30 && c <= 37) return ['color', COLORS_16[c - 30]]
  if (c >= 90 && c <= 97) return ['color', COLORS_16[c - 82]]
  if (c >= 40 && c <= 47) return ['background', COLORS_16[c - 40]]
  if (c >= 100 && c <= 107) return ['background', COLORS_16[c - 92]]
  return null
}

// Handle 38/48 extended-color introducers. Returns the new index after consumption.
function consumeExtendedColor(codes: number[], i: number, styles: Map<string, string>): number {
  const c = codes[i]
  const prop = c === 38 ? 'color' : 'background'
  const mode = codes[i + 1]
  if (mode === 5) {
    styles.set(prop, color256(codes[i + 2] || 0))
    return i + 2
  }
  if (mode === 2) {
    styles.set(prop, `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`)
    return i + 4
  }
  return i
}

// Apply a list of SGR codes to the running style map.
function applyCodes(codes: number[], styles: Map<string, string>): void {
  let i = 0
  while (i < codes.length) {
    const c = codes[i]
    if (c === 0) {
      styles.clear()
    } else if (STYLE_FLAGS[c]) {
      const [k, v] = STYLE_FLAGS[c]
      styles.set(k, v)
    } else if (c === 38 || c === 48) {
      i = consumeExtendedColor(codes, i, styles)
    } else {
      const color = colorFromCode(c)
      if (color) styles.set(color[0], color[1])
    }
    i++
  }
}

function wrapWithStyles(html: string, styles: Map<string, string>): string {
  if (styles.size === 0) return html
  const styleStr = Array.from(styles).map(([k, v]) => `${k}:${v}`).join(';')
  return `<span style="${styleStr}">${html}</span>`
}

export function ansiToHtml(text: string): string {
  const parts: string[] = []
  const styles = new Map<string, string>()
  let lastIndex = 0

  for (const match of text.matchAll(ANSI_RE)) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push(wrapWithStyles(escapeHtml(before), styles))
    lastIndex = match.index! + match[0].length

    const codes = match[1] ? match[1].split(';').map(Number) : [0]
    applyCodes(codes, styles)
  }

  const remaining = text.slice(lastIndex)
  if (remaining) parts.push(wrapWithStyles(escapeHtml(remaining), styles))

  return parts.join('') || '&nbsp;'
}

export function ansiLinesToHtml(lines: string[]): string {
  return lines.map(line => `<div>${ansiToHtml(line)}</div>`).join('')
}
