/**
 * Model -> context window size (in tokens).
 *
 * This is a *fallback* — the authoritative value comes from the SDK's
 * `modelUsage[model].contextWindow` on each turn result, persisted in
 * `conversations.last_context_window`. This function only kicks in before the
 * first turn completes.
 *
 * 2026 state (as of April):
 *   - Opus 4.6+, Sonnet 4.6, Mythos Preview → 1M native (GA since 2026-03-14, no beta needed)
 *   - Sonnet 4.5 / Sonnet 4 → 200k only (1M beta retired on 2026-04-30)
 *   - Haiku 4.5 → 200k
 *   - `[1m]` suffix (legacy alias) → force 1M
 */

export const DEFAULT_CONTEXT_WINDOW = 200_000
export const EXTENDED_CONTEXT_WINDOW = 1_000_000

export function getContextWindow(modelId: string | null | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW

  // Legacy explicit opt-in alias
  if (modelId.endsWith('[1m]')) return EXTENDED_CONTEXT_WINDOW

  // 2026 GA 1M: Opus 4.6+, Sonnet 4.6+, Mythos
  if (/^claude-opus-4-([6-9]|\d{2,})/.test(modelId)) return EXTENDED_CONTEXT_WINDOW
  if (/^claude-sonnet-4-([6-9]|\d{2,})/.test(modelId)) return EXTENDED_CONTEXT_WINDOW
  if (/^claude-mythos/.test(modelId)) return EXTENDED_CONTEXT_WINDOW

  return DEFAULT_CONTEXT_WINDOW
}

/**
 * Effective context window for display.
 *
 * The SDK's `modelUsage.contextWindow` is *not* authoritative for models it
 * doesn't know about — it silently falls back to 200k for unknown model IDs
 * (e.g. opus-4-7 is absent from @anthropic-ai/claude-agent-sdk 0.2.114's
 * internal metadata table). So we take the **maximum** of what the SDK
 * reported and what we statically know the model supports.
 *
 * This is safe because:
 *   - For known 1M models, our static table matches Anthropic's docs.
 *   - For known 200k models, both sources agree on 200k.
 *   - For truly unknown models, both fall back to 200k (conservative).
 *   - A future SDK that learns opus-4-7 (reports 1M) won't be overridden.
 */
export function getEffectiveContextWindow(
  modelId: string | null | undefined,
  observedFromSdk: number | null | undefined
): number {
  const staticBest = getContextWindow(modelId)
  return Math.max(observedFromSdk ?? 0, staticBest)
}

export interface ConversationUsage {
  input?: number | null
  output?: number | null
  cacheRead?: number | null
  cacheCreation?: number | null
}

/**
 * Total tokens sent to the model for the last turn.
 * Sum of fresh input + cache reads + cache creation — the three together equal
 * what Anthropic counts against the context window.
 */
export function computeUsedTokens(usage: ConversationUsage): number {
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheCreation ?? 0)
}
