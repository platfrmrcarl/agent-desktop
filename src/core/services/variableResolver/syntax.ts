export type Token =
  | { type: 'lit'; value: string }
  | { type: 'var'; name: string; args: string[]; raw: string }

const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)((?::[^:}]*)*)\}/g

/**
 * Parse a prompt into literal and variable tokens.
 * - `{name}` → VAR with empty args
 * - `{name:a}` → VAR with args = ['a']
 * - `{name:a:b}` → VAR with args = ['a', 'b']
 * - `{name:}` → VAR with args = [''] (explicit empty arg)
 * - Anything that does not match → LIT
 */
export function tokenize(input: string): Token[] {
  if (input.length === 0) return []
  const tokens: Token[] = []
  let lastIndex = 0
  for (const m of input.matchAll(VAR_PATTERN)) {
    const start = m.index!
    if (start > lastIndex) {
      tokens.push({ type: 'lit', value: input.slice(lastIndex, start) })
    }
    const [raw, name, argPart] = m
    const args = argPart.length > 0 ? argPart.slice(1).split(':') : []
    tokens.push({ type: 'var', name, args, raw })
    lastIndex = start + raw.length
  }
  if (lastIndex < input.length) {
    tokens.push({ type: 'lit', value: input.slice(lastIndex) })
  }
  return tokens
}
