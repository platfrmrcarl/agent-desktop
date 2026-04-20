/**
 * Context usage breakdown, Claude Code `/context` style.
 *
 * Strategy:
 *   - Count *what we own* locally with a BPE tokenizer (system prompt, message
 *     history, compact summary). Fast, offline.
 *   - For MCP tool specs and SDK internals we can't cheaply introspect, derive
 *     a single "Tools & overhead" bucket from `sdk_total − locally_counted`,
 *     using the numbers the SDK persisted on the last turn. Honest over precise.
 *   - Always reserve an autocompact buffer (~3% of the window) so the ceiling
 *     we show matches what a /compact operation would actually need.
 *
 * The `counterMode` parameter chooses how to compute the *total*:
 *   - `'local'`: the last SDK `usage` sum (default, zero cost).
 *   - `'anthropic'`: caller may swap in a live `count_tokens` API result (not
 *     implemented in this module — the caller resolves the override and passes
 *     `totalOverride`).
 */

import { promises as fsp } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { localTokenizer } from '../../shared/tokenCounter'
import { getEffectiveContextWindow } from '../../shared/contextWindow'
import { parseCustomModelContextLengths } from '../types/constants'

export type TokenCounterMode = 'local' | 'anthropic'

export interface ContextCategory {
  /** Translation key / UI label. Keep short — the bubble lists these vertically. */
  label: string
  /** Approximate token count. `null` means "unknown, not yet measurable". */
  tokens: number | null
  /** Purely informational hint shown in a small muted font. */
  hint?: string
}

export interface ContextBreakdown {
  /** Best estimate of total tokens in the context for the NEXT turn. */
  total: number
  /** Whether the total is exact (from Anthropic's count_tokens API) or approximate. */
  totalIsExact: boolean
  /** Effective window size (SDK + static + custom override). */
  window: number
  /** Reserved capacity for a future /compact call (~3% of window). */
  autocompactBuffer: number
  /** `window - total - autocompactBuffer`, clamped at 0. */
  free: number
  /** Percentage of the window used, 0–100. */
  percentUsed: number
  /** Human-readable categories in display order. */
  categories: ContextCategory[]
  /** Which mode produced this result. */
  mode: TokenCounterMode
  /** True if no turn has completed yet — the "overhead" category is guessed/unknown. */
  preFirstTurn: boolean
}

interface ConversationRow {
  model: string | null
  compact_summary: string | null
  cleared_at: string | null
  last_input_tokens: number | null
  last_output_tokens: number | null
  last_cache_read_tokens: number | null
  last_cache_creation_tokens: number | null
  last_context_window: number | null
}

interface SettingsRow { key: string; value: string | null }

function readConversation(db: SqlJsAdapter, conversationId: number): ConversationRow | null {
  const row = (db as unknown as { prepare: (q: string) => { get: (p: number) => unknown } })
    .prepare(`SELECT model, compact_summary, cleared_at,
                     last_input_tokens, last_output_tokens,
                     last_cache_read_tokens, last_cache_creation_tokens,
                     last_context_window
              FROM conversations WHERE id = ?`)
    .get(conversationId) as ConversationRow | undefined
  return row ?? null
}

function readSetting(db: SqlJsAdapter, key: string): string | null {
  const row = (db as unknown as { prepare: (q: string) => { get: (p: string) => unknown } })
    .prepare('SELECT key, value FROM settings WHERE key = ?')
    .get(key) as SettingsRow | undefined
  return row?.value ?? null
}

interface MessageRow { content: string; tool_calls: string | null; role: 'user' | 'assistant' }

function fetchMessages(db: SqlJsAdapter, conversationId: number, clearedAt: string | null): MessageRow[] {
  let query = 'SELECT content, tool_calls, role FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]
  if (clearedAt) {
    query += ' AND created_at > ?'
    params.push(clearedAt)
  }
  query += ' ORDER BY created_at ASC'
  const rows = (db as unknown as { prepare: (q: string) => { all: (...p: unknown[]) => unknown[] } })
    .prepare(query).all(...params) as MessageRow[]
  return rows
}

export interface BuildBreakdownInput {
  db: SqlJsAdapter
  conversationId: number
  /** Precomputed system prompt — caller should pass what will actually be sent to the SDK. */
  systemPrompt: string
  /** Token counter mode for the total calculation. */
  mode: TokenCounterMode
  /** When mode is 'anthropic', caller passes the authoritative total here. */
  totalOverride?: number | null
  /** Effective skills discovery mode (from ai_skills cascade). Controls which scopes to scan. */
  skillsMode?: 'off' | 'user' | 'project' | 'local'
  /** Project CWD — needed to resolve project/local skill scopes. */
  cwd?: string
}

/**
 * Count tokens bundled into the system prompt as SKILL.md frontmatters, by scanning
 * the same scopes the Claude Agent SDK would via `settingSources`.
 *
 * The SDK reads `.claude/skills/*\/SKILL.md` and `.claude/plugins/*\/skills/*\/SKILL.md`
 * under each enabled scope and bundles the frontmatter block (name + description + more)
 * of every skill into the initial system prompt so the model can decide which to invoke.
 *
 * With many plugins installed (1000+ skills seen in the wild), this can silently add
 * ~100k tokens to the context on every turn. We count it so the user sees it.
 */
async function countSkillsFrontmatters(scopes: string[]): Promise<{ tokens: number; count: number }> {
  let tokens = 0
  let count = 0
  const seen = new Set<string>()

  async function walk(dir: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch { return }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.name === 'SKILL.md' && !seen.has(full)) {
        seen.add(full)
        try {
          const content = await fsp.readFile(full, 'utf-8')
          const m = content.match(/^---\s*\n([\s\S]*?)\n---/)
          if (m) {
            tokens += localTokenizer.count(m[1])
            count++
          }
        } catch { /* unreadable — skip */ }
      }
    }
  }

  for (const scope of scopes) {
    await walk(join(scope, 'skills'))
    await walk(join(scope, 'plugins'))
  }
  return { tokens, count }
}

function scopesForSkillsMode(mode: 'off' | 'user' | 'project' | 'local', cwd?: string): string[] {
  if (mode === 'off') return []
  const scopes = [join(homedir(), '.claude')]
  if (mode === 'project' || mode === 'local') {
    if (cwd) scopes.push(join(cwd, '.claude'))
  }
  if (mode === 'local') {
    if (cwd) scopes.push(join(cwd, '.claude.local'))
  }
  return scopes
}

const AUTOCOMPACT_BUFFER_RATIO = 0.03 // 3% — matches Claude Code's reserve

export async function buildContextBreakdown(input: BuildBreakdownInput): Promise<ContextBreakdown> {
  const { db, conversationId, systemPrompt, mode, totalOverride, skillsMode = 'off', cwd } = input

  const conv = readConversation(db, conversationId)
  if (!conv) {
    return emptyBreakdown(mode)
  }

  // --- Compute window ---
  const customOverrides = parseCustomModelContextLengths(readSetting(db, 'ai_customModelContextLengths') || undefined)
  const window = getEffectiveContextWindow(conv.model ?? null, conv.last_context_window ?? null, customOverrides)

  // --- Locally-counted categories ---
  const systemPromptTokens = localTokenizer.count(systemPrompt)

  let compactSummaryTokens = 0
  if (conv.compact_summary) {
    compactSummaryTokens = localTokenizer.count(`[Previous conversation summary]\n${conv.compact_summary}`)
  }

  const rows = fetchMessages(db, conversationId, conv.cleared_at)
  const messagesTokens = rows.reduce((sum, r) => sum + localTokenizer.count(r.content), 0)
  // Tool calls (arguments + outputs) live in a separate column; they represent the
  // tool_use / tool_result blocks that travel in the request alongside plain text.
  // Count them as their own category so the user sees how much of their context a
  // chatty bash or large Read call has eaten.
  const toolExchangesTokens = rows.reduce((sum, r) => {
    if (!r.tool_calls) return sum
    return sum + localTokenizer.count(r.tool_calls)
  }, 0)

  // --- Skills: frontmatter of every SKILL.md in the enabled scopes ---
  const skillScopes = scopesForSkillsMode(skillsMode, cwd)
  const skills = skillScopes.length > 0
    ? await countSkillsFrontmatters(skillScopes)
    : { tokens: 0, count: 0 }

  const localCounted = systemPromptTokens + compactSummaryTokens + messagesTokens + toolExchangesTokens + skills.tokens

  // --- Derive the "Tools & SDK overhead" bucket from the last SDK turn ---
  const preFirstTurn = conv.last_input_tokens == null
    && conv.last_cache_read_tokens == null
    && conv.last_cache_creation_tokens == null

  const sdkReportedTotal = (conv.last_input_tokens ?? 0)
    + (conv.last_cache_read_tokens ?? 0)
    + (conv.last_cache_creation_tokens ?? 0)

  // If we have SDK numbers, derive overhead as the gap between SDK-total and what we counted.
  // If SDK says less than we counted (rare, possible with multi-turn drift) clamp to 0.
  const overheadFromSdk = preFirstTurn ? null : Math.max(0, sdkReportedTotal - localCounted)

  // --- Build category list (Claude Code ordering: system first, tools, memory, skills, messages, summary) ---
  const categories: ContextCategory[] = []
  categories.push({ label: 'System prompt', tokens: systemPromptTokens })
  categories.push({
    label: 'Tools & SDK overhead',
    tokens: overheadFromSdk,
    hint: preFirstTurn
      ? 'measured after the first turn'
      : 'MCP tool specs + internal framework overhead',
  })
  if (compactSummaryTokens > 0) {
    categories.push({
      label: 'Compact summary',
      tokens: compactSummaryTokens,
      hint: 'injected as synthetic assistant turn',
    })
  }
  categories.push({
    label: 'Messages',
    tokens: messagesTokens,
    hint: rows.length > 0 ? `${rows.length} turn${rows.length > 1 ? 's' : ''}` : undefined,
  })
  if (toolExchangesTokens > 0) {
    const toolCount = rows.filter((r) => r.tool_calls).length
    categories.push({
      label: 'Tool exchanges',
      tokens: toolExchangesTokens,
      hint: `tool_use + tool_result across ${toolCount} turn${toolCount > 1 ? 's' : ''}`,
    })
  }
  if (skills.count > 0) {
    categories.push({
      label: 'Skills',
      tokens: skills.tokens,
      hint: `${skills.count} SKILL.md frontmatters bundled (ai_skills: ${skillsMode})`,
    })
  }

  // --- Total ---
  let total: number
  let totalIsExact: boolean
  if (mode === 'anthropic' && typeof totalOverride === 'number' && totalOverride > 0) {
    total = totalOverride
    totalIsExact = true
  } else if (preFirstTurn) {
    total = localCounted
    totalIsExact = false
  } else {
    total = sdkReportedTotal
    totalIsExact = false
  }

  const autocompactBuffer = Math.round(window * AUTOCOMPACT_BUFFER_RATIO)
  const free = Math.max(0, window - total - autocompactBuffer)
  const percentUsed = window > 0 ? Math.min(100, Math.round((total / window) * 100)) : 0

  return {
    total,
    totalIsExact,
    window,
    autocompactBuffer,
    free,
    percentUsed,
    categories,
    mode,
    preFirstTurn,
  }
}

function emptyBreakdown(mode: TokenCounterMode): ContextBreakdown {
  return {
    total: 0,
    totalIsExact: false,
    window: 200_000,
    autocompactBuffer: 6_000,
    free: 194_000,
    percentUsed: 0,
    categories: [],
    mode,
    preFirstTurn: true,
  }
}
