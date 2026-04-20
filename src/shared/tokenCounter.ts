/**
 * Token counter abstraction.
 *
 * Two concrete implementations:
 *   - {@link LocalTokenizer}: gpt-tokenizer (BPE), fast + offline, ~±10% on Claude text
 *   - Anthropic `count_tokens` endpoint: exact but costs an API round-trip (wired at the
 *     service layer — not in this module, to keep shared/ free of network deps).
 *
 * The user picks between the two via the `ai_contextTokenCounter` setting.
 * PI backend is always local (no equivalent endpoint).
 */

import { encode } from 'gpt-tokenizer'

export interface TokenCounter {
  /** Number of tokens in `text`. Never throws — returns 0 on empty input. */
  count(text: string): number
}

export class LocalTokenizer implements TokenCounter {
  count(text: string): number {
    if (!text) return 0
    try {
      return encode(text).length
    } catch {
      // Fallback heuristic if the tokenizer ever chokes on weird input (rare): ~4 chars/token
      return Math.ceil(text.length / 4)
    }
  }
}

export const localTokenizer = new LocalTokenizer()

/** Count tokens of a JSON-serialisable object. Stable ordering isn't needed — we only care about size. */
export function countJsonTokens(obj: unknown, counter: TokenCounter = localTokenizer): number {
  if (obj == null) return 0
  try {
    return counter.count(JSON.stringify(obj))
  } catch {
    return 0
  }
}
