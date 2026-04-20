import { describe, it, expect } from 'vitest'
import { getContextWindow, getEffectiveContextWindow, computeUsedTokens, DEFAULT_CONTEXT_WINDOW, EXTENDED_CONTEXT_WINDOW } from './contextWindow'

describe('getContextWindow', () => {
  it('returns 1M natively for Opus 4.6+ and Sonnet 4.6+ (GA since 2026-03-14)', () => {
    expect(getContextWindow('claude-opus-4-6')).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getContextWindow('claude-opus-4-7')).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getContextWindow('claude-sonnet-4-6')).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('returns 1M for Claude Mythos Preview', () => {
    expect(getContextWindow('claude-mythos-preview')).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('returns 200k for Sonnet 4.5, Sonnet 4, and Haiku (1M beta retires 2026-04-30 for Sonnet)', () => {
    expect(getContextWindow('claude-sonnet-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getContextWindow('claude-sonnet-4-0')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getContextWindow('claude-haiku-4-5')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('still honors the legacy [1m] suffix as explicit 1M opt-in', () => {
    expect(getContextWindow('claude-opus-4-7[1m]')).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getContextWindow('claude-sonnet-4-5[1m]')).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('defaults to 200k for empty, null, or undefined', () => {
    expect(getContextWindow('')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('defaults to 200k for unknown custom model ids', () => {
    expect(getContextWindow('custom-model-xyz')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('only matches [1m] as a suffix, not anywhere in the id', () => {
    expect(getContextWindow('claude-[1m]-sonnet')).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('matches major.minor with multi-digit minors (future-proof for 4.10+)', () => {
    expect(getContextWindow('claude-opus-4-10')).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getContextWindow('claude-sonnet-4-12')).toBe(EXTENDED_CONTEXT_WINDOW)
  })
})

describe('getEffectiveContextWindow', () => {
  it('overrides a stale SDK-reported 200k when static table knows 1M (opus-4-7 bug)', () => {
    // SDK 0.2.37/0.2.114 does not know opus-4-7 and defaults to 200k;
    // our static table correctly says 1M per Anthropic docs. Take the max.
    expect(getEffectiveContextWindow('claude-opus-4-7', 200_000)).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getEffectiveContextWindow('claude-sonnet-4-6', 200_000)).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('trusts the SDK when it reports a larger window than our static guess', () => {
    // Future-proofing: if Anthropic ships a new model with 2M and the SDK knows it
    // but our static table doesn't, we still show 2M.
    expect(getEffectiveContextWindow('claude-future-model-7', 2_000_000)).toBe(2_000_000)
  })

  it('returns static value when SDK has not reported yet', () => {
    expect(getEffectiveContextWindow('claude-opus-4-7', null)).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getEffectiveContextWindow('claude-sonnet-4-5', null)).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getEffectiveContextWindow('claude-opus-4-7', undefined)).toBe(EXTENDED_CONTEXT_WINDOW)
  })

  it('agrees with SDK when both report 200k for a 200k model', () => {
    expect(getEffectiveContextWindow('claude-sonnet-4-5', 200_000)).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('falls back gracefully when nothing is known', () => {
    expect(getEffectiveContextWindow(null, null)).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(getEffectiveContextWindow('', 0)).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  it('respects the user custom-model override when provided', () => {
    expect(getEffectiveContextWindow('my-local-llm', null, { 'my-local-llm': 128_000 })).toBe(128_000)
    // Override wins even over a bigger static guess (user knows their model)
    expect(getEffectiveContextWindow('my-local-llm', 2_000_000, { 'my-local-llm': 128_000 })).toBe(128_000)
  })

  it('ignores zero or negative override and falls back to the max logic', () => {
    expect(getEffectiveContextWindow('claude-opus-4-7', null, { 'claude-opus-4-7': 0 })).toBe(EXTENDED_CONTEXT_WINDOW)
    expect(getEffectiveContextWindow('claude-opus-4-7', null, { 'claude-opus-4-7': -1 })).toBe(EXTENDED_CONTEXT_WINDOW)
  })
})

describe('computeUsedTokens', () => {
  it('sums input + cacheRead + cacheCreation', () => {
    expect(computeUsedTokens({ input: 100, cacheRead: 50, cacheCreation: 25 })).toBe(175)
  })

  it('treats null and undefined as zero', () => {
    expect(computeUsedTokens({ input: 100, cacheRead: null, cacheCreation: undefined })).toBe(100)
  })

  it('ignores output_tokens (not part of context window consumption)', () => {
    expect(computeUsedTokens({ input: 100, output: 500, cacheRead: 0, cacheCreation: 0 })).toBe(100)
  })

  it('returns 0 when all fields missing', () => {
    expect(computeUsedTokens({})).toBe(0)
  })
})
