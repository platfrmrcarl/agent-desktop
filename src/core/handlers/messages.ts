import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'
import type { AISettings } from '../services/streaming'
import type { Message, Attachment, ToolCall, ToolApprovalResponse, AskUserResponse, KnowledgeSelection, CwdWhitelistEntry } from '../types/types'
import { streamMessage, abortStream, respondToApproval, sendChunk, notifyConversationUpdated, injectApiKeyEnv } from '../services/streaming'
import { summarizeWithModel } from '../services/summarization'
import { validateString, validatePositiveInt, validatePathSafe } from '../utils/validate'
import { safeJsonParse } from '../utils/json'
import { HAIKU_MODEL } from '../types/constants'
import { mkdirSync } from 'fs'
import { promises as fsp } from 'fs'
import { join, basename, extname, resolve, relative } from 'path'

// ─── Options ──────────────────────────────────────────────────

export interface MessagesHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
  knowledgesDir?: string
  supportedKnowledgeExts?: Set<string>
  onTtsSpeak?: (content: string, conversationId: number, aiSettings: AISettings) => void
  onTtsStop?: () => void
  onWebhookFire?: (url: string, payload: Record<string, unknown>) => void
  getSchedulerMcpConfig?: (conversationId: number) => Record<string, unknown> | null
  onSessionInvalidate?: (conversationId: number) => void
}

// ─── Internal State ───────────────────────────────────────────

const streamGenerations = new Map<number, number>()

const CWD_CACHE_MAX = 1000
const cwdCache = new Map<number, string>()

export function invalidateCwdCache(conversationId: number): void {
  cwdCache.delete(conversationId)
}

// validatePathSafe imported from ../utils/validate

// ─── Retry Settings ───────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readRetrySettings(db: SqlJsAdapter): { enabled: boolean; maxAttempts: number; initialDelayMs: number } {
  const rows = (db as any)
    .prepare("SELECT key, value FROM settings WHERE key IN ('retry_enabled', 'retry_maxAttempts', 'retry_initialDelayMs')")
    .all() as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return {
    enabled: (map['retry_enabled'] ?? 'true') === 'true',
    maxAttempts: Math.max(1, Math.min(10, Number(map['retry_maxAttempts']) || 3)),
    initialDelayMs: Math.max(1000, Math.min(30000, Number(map['retry_initialDelayMs']) || 2000)),
  }
}

/** Increment the generation counter for a conversation, cancelling any pending retry */
export function invalidateRetry(conversationId: number): void {
  streamGenerations.set(conversationId, (streamGenerations.get(conversationId) ?? 0) + 1)
}

// ─── Attachment Helpers ───────────────────────────────────────

async function uniqueDestPath(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  try { await fsp.access(candidate) } catch { return candidate }
  const ext = extname(name)
  const base = basename(name, ext)
  let i = 1
  while (i < 1000) {
    candidate = join(dir, `${base}_${i}${ext}`)
    try { await fsp.access(candidate) } catch { return candidate }
    i++
  }
  return candidate
}

export async function copyAttachmentsToSession(
  cwd: string,
  attachments: Attachment[]
): Promise<{ copied: Attachment[]; contentSuffix: string }> {
  if (!attachments.length) return { copied: attachments, contentSuffix: '' }

  const attachDir = join(cwd, 'attachments')
  await fsp.mkdir(attachDir, { recursive: true })

  const copied: Attachment[] = []
  const lines: string[] = []
  for (const att of attachments) {
    const destPath = await uniqueDestPath(attachDir, att.name)
    await fsp.copyFile(att.path, destPath)
    const finalName = basename(destPath)
    copied.push({ ...att, name: finalName, path: destPath })
    lines.push(`[${finalName}](${destPath})`)
  }

  const contentSuffix = '\n\n' + lines.join('\n')
  return { copied, contentSuffix }
}

// ─── Message History ──────────────────────────────────────────

export function buildMessageHistory(db: SqlJsAdapter, conversationId: number, limit = 100): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conv = (db as any).prepare('SELECT cleared_at, compact_summary FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null; compact_summary: string | null } | undefined

  let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]

  if (conv?.cleared_at) {
    query += ' AND created_at > ?'
    params.push(conv.cleared_at)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = (db as any).prepare(query).all(...params) as Pick<Message, 'role' | 'content'>[]

  const result = rows.reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }))

  if (conv?.compact_summary) {
    result.unshift({ role: 'assistant', content: `[Previous conversation summary]\n${conv.compact_summary}` })
  }

  return result
}

// ─── Folder Overrides ─────────────────────────────────────────

function getFolderOverrides(db: SqlJsAdapter, folderId: number): Record<string, string> {
  const row = (db as any)
    .prepare('SELECT ai_overrides FROM folders WHERE id = ?')
    .get(folderId) as { ai_overrides: string | null } | undefined
  return row?.ai_overrides ? safeJsonParse<Record<string, string>>(row.ai_overrides, {}) : {}
}

// ─── System Prompt ────────────────────────────────────────────

export async function getSystemPrompt(
  db: SqlJsAdapter,
  conversationId: number,
  cwd: string,
  opts?: { knowledgesDir?: string; supportedKnowledgeExts?: Set<string>; getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null }
): Promise<string> {
  const cwdDirective = `Your working directory is ${cwd}. Use absolute paths for all file operations.`

  const row = (db as any)
    .prepare('SELECT system_prompt, folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { system_prompt: string | null; folder_id: number | null; ai_overrides: string | null } | undefined

  let prompt: string
  if (row?.system_prompt) {
    prompt = `${cwdDirective}\n\n${row.system_prompt}`
  } else {
    let cascadedPrompt: string | undefined

    if (row?.ai_overrides) {
      const convOv = safeJsonParse<Record<string, string>>(row.ai_overrides, {})
      if (convOv.ai_defaultSystemPrompt) cascadedPrompt = convOv.ai_defaultSystemPrompt
    }

    if (!cascadedPrompt && row?.folder_id) {
      const folderOv = getFolderOverrides(db, row.folder_id)
      if (folderOv.ai_defaultSystemPrompt) cascadedPrompt = folderOv.ai_defaultSystemPrompt
    }

    if (!cascadedPrompt) {
      const globalRow = (db as any)
        .prepare("SELECT value FROM settings WHERE key = 'ai_defaultSystemPrompt'")
        .get() as { value: string } | undefined
      cascadedPrompt = globalRow?.value || undefined
    }

    prompt = cascadedPrompt ? `${cwdDirective}\n\n${cascadedPrompt}` : cwdDirective
  }

  // Agent personality & language injection
  function cascadeAgentKey(key: string): string | undefined {
    if (row?.ai_overrides) {
      const convOv = safeJsonParse<Record<string, string>>(row.ai_overrides, {})
      if (convOv[key]) return convOv[key]
    }
    if (row?.folder_id) {
      const folderOv = getFolderOverrides(db, row.folder_id)
      if (folderOv[key]) return folderOv[key]
    }
    const globalRow = (db as any)
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return globalRow?.value || undefined
  }

  const agentPersonality = cascadeAgentKey('agent_personality')
  const agentLanguage = cascadeAgentKey('agent_language')

  if (agentPersonality) {
    prompt = `Personality: ${agentPersonality}\n\n${prompt}`
  }
  if (agentLanguage) {
    prompt = `Always respond in ${agentLanguage}.\n\n${prompt}`
  }

  // Knowledge base injection
  const allOverrides = row?.ai_overrides
    ? safeJsonParse<Record<string, string>>(row.ai_overrides, {})
    : {}

  let knowledgeFoldersRaw = allOverrides['ai_knowledgeFolders']
  if (!knowledgeFoldersRaw && row?.folder_id) {
    knowledgeFoldersRaw = getFolderOverrides(db, row.folder_id)['ai_knowledgeFolders']
  }

  if (knowledgeFoldersRaw && opts?.knowledgesDir) {
    const knowledgesDir = opts.knowledgesDir
    const supportedExts = opts.supportedKnowledgeExts ?? new Set(['.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.yaml', '.yml'])
    const selections = safeJsonParse<KnowledgeSelection[]>(knowledgeFoldersRaw, [])

    if (Array.isArray(selections) && selections.length > 0) {
      let kbContent = ''
      let totalSize = 0
      const writablePaths: string[] = []

      for (const sel of selections) {
        if (!sel.folder || typeof sel.folder !== 'string') continue
        if (sel.folder.includes('..') || sel.folder.includes('/') || sel.folder.includes('\\')) continue

        const collectionPath = join(knowledgesDir, sel.folder)
        const resolved = resolve(collectionPath)
        if (!resolved.startsWith(knowledgesDir)) continue

        const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
        if (access === 'readwrite') {
          writablePaths.push(resolved)
        }

        async function readCollectionFiles(dir: string): Promise<void> {
          let entries
          try {
            entries = await fsp.readdir(dir, { withFileTypes: true })
          } catch { return }

          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue
            const fullPath = join(dir, entry.name)
            if (entry.isDirectory()) {
              await readCollectionFiles(fullPath)
            } else if (supportedExts.has(extname(entry.name).toLowerCase())) {
              try {
                const content = await fsp.readFile(fullPath, 'utf-8')
                totalSize += content.length
                if (totalSize > 500_000) return
                const relPath = relative(collectionPath, fullPath)
                kbContent += `\n\n--- Knowledge [${access}]: ${sel.folder}/${relPath} ---\n${content}\n---`
              } catch {
                continue
              }
            }
          }
        }

        await readCollectionFiles(collectionPath)
        if (totalSize > 500_000) break
      }

      if (kbContent) {
        prompt += kbContent
      }
      if (writablePaths.length > 0) {
        prompt += '\n\nYou have write access to the following knowledge directories:\n' +
          writablePaths.map(p => `- ${p}`).join('\n')
      }
    }
  }

  // Scheduler directive
  if (opts?.getSchedulerMcpConfig) {
    const schedulerMcpAvailable = opts.getSchedulerMcpConfig(conversationId) !== null
    if (schedulerMcpAvailable) {
      prompt += '\n\nYou have access to a built-in task scheduler via MCP tools (schedule_task, list_scheduled_tasks, cancel_scheduled_task). ' +
        'Use these tools for reminders, scheduled tasks, and recurring actions. ' +
        'Do NOT use cron, at, systemd timers, or other system schedulers — always use the built-in schedule_task tool. ' +
        'For one-time reminders, use the delay_minutes parameter. For recurring tasks, use interval_value + interval_unit.'
    }
  }

  return prompt
}

// ─── CWD Resolution ───────────────────────────────────────────

function getConversationCwd(db: SqlJsAdapter, conversationId: number, sessionsBase: string): string {
  const cached = cwdCache.get(conversationId)
  if (cached) return cached

  if (cwdCache.size >= CWD_CACHE_MAX) {
    const firstKey = cwdCache.keys().next().value!
    cwdCache.delete(firstKey)
  }

  const row = (db as any)
    .prepare('SELECT cwd FROM conversations WHERE id = ?')
    .get(conversationId) as { cwd: string | null } | undefined

  let cwd: string
  if (row?.cwd) {
    cwd = validatePathSafe(row.cwd)
  } else {
    cwd = join(sessionsBase, String(conversationId))
    cwd = validatePathSafe(cwd, sessionsBase)
  }

  mkdirSync(cwd, { recursive: true })
  cwdCache.set(conversationId, cwd)
  return cwd
}

// ─── MCP Server Filtering ────────────────────────────────────

function filterMcpServers(
  servers: AISettings['mcpServers'],
  disabledJson: string | undefined
): AISettings['mcpServers'] {
  if (!disabledJson) return servers
  const disabled = safeJsonParse<string[]>(disabledJson, [])
  if (!Array.isArray(disabled) || disabled.length === 0) return servers
  const disabledSet = new Set(disabled)
  const filtered: AISettings['mcpServers'] = {}
  for (const [name, config] of Object.entries(servers || {})) {
    if (!disabledSet.has(name)) filtered[name] = config
  }
  return filtered
}

// ─── AI Settings ──────────────────────────────────────────────

export function getAISettings(db: SqlJsAdapter, conversationId: number, opts?: { sessionsBase: string; knowledgesDir?: string; getSchedulerMcpConfig?: (id: number) => Record<string, unknown> | null }): AISettings {
  const sessionsBase = opts?.sessionsBase ?? ''
  const keys = ['ai_sdkBackend', 'ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd', 'ai_permissionMode', 'ai_requirePlanApproval', 'ai_tools', 'hooks_cwdRestriction', 'hooks_cwdWhitelist', 'settings_sharedAcrossBackends', 'ai_knowledgeFolders', 'ai_skills', 'ai_skillsEnabled', 'ai_disabledSkills', 'pi_disabledExtensions', 'pi_extensionsDir', 'ai_apiKey', 'ai_baseUrl', 'ai_customModel', 'tts_responseMode', 'tts_autoWordLimit', 'tts_summaryPrompt', 'tts_summaryModel', 'ai_compactModel', 'ai_titleModel', 'webhook_completionUrl']
  const rows = (db as any)
    .prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all(...keys) as { key: string; value: string }[]

  const map: Record<string, string> = {}
  for (const row of rows) {
    map[row.key] = row.value
  }

  const globalApiKey = map['ai_apiKey'] || undefined
  const globalBaseUrl = map['ai_baseUrl'] || undefined
  const globalCustomModel = map['ai_customModel'] || undefined
  const globalModel = map['ai_model'] || undefined
  const globalPiExtensionsDir = map['pi_extensionsDir'] || undefined

  const convRow = (db as any)
    .prepare('SELECT folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { folder_id: number | null; ai_overrides: string | null } | undefined

  if (convRow?.folder_id) {
    const folderOverrides = getFolderOverrides(db, convRow.folder_id)
    for (const [k, v] of Object.entries(folderOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }

  if (convRow?.ai_overrides) {
    const convOverrides = safeJsonParse<Record<string, string>>(convRow.ai_overrides, {})
    for (const [k, v] of Object.entries(convOverrides)) {
      if (v !== undefined && v !== '') map[k] = v
    }
  }

  const cwdWhitelist = safeJsonParse<CwdWhitelistEntry[]>(map['hooks_cwdWhitelist'] || '[]', [])

  const toolsValue = map['ai_tools'] || 'preset:claude_code'
  let tools: AISettings['tools']
  if (toolsValue === 'preset:claude_code') {
    tools = { type: 'preset', preset: 'claude_code' }
  } else {
    const parsed = safeJsonParse<string[] | null>(toolsValue, null)
    tools = parsed ?? { type: 'preset', preset: 'claude_code' }
  }

  const mcpRows = (db as any)
    .prepare('SELECT name, type, command, args, env, url, headers FROM mcp_servers WHERE enabled = 1')
    .all() as { name: string; type: string | null; command: string; args: string; env: string; url: string | null; headers: string | null }[]

  const mcpServers: AISettings['mcpServers'] = {}
  for (const row of mcpRows) {
    try {
      const transport = row.type || 'stdio'
      if (transport === 'http' || transport === 'sse') {
        if (!row.url) continue
        const headers = safeJsonParse<Record<string, string>>(row.headers || '{}', {})
        mcpServers[row.name] = {
          type: transport,
          url: row.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }
      } else {
        const args = safeJsonParse<string[]>(row.args, [])
        const env = safeJsonParse<Record<string, string>>(row.env, {})
        mcpServers[row.name] = { command: row.command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
      }
    } catch (err) {
      console.error(`[messages] Invalid MCP config for ${row.name}:`, err)
    }
  }

  // Merge knowledge folder selections into cwdWhitelist
  if (opts?.knowledgesDir) {
    const kfRaw = map['ai_knowledgeFolders']
    const knowledgeFolders = kfRaw ? safeJsonParse<KnowledgeSelection[]>(kfRaw, []) : []
    if (Array.isArray(knowledgeFolders)) {
      const knowledgesDir = opts.knowledgesDir
      for (const sel of knowledgeFolders) {
        if (!sel.folder || !sel.folder.length) continue
        if (sel.folder.includes('..') || sel.folder.includes('/') || sel.folder.includes('\\')) continue
        const resolved = resolve(join(knowledgesDir, sel.folder))
        if (!resolved.startsWith(knowledgesDir)) continue
        const access = sel.access === 'readwrite' ? 'readwrite' : 'read'
        cwdWhitelist.push({ path: resolved, access })
      }
    }
  }

  const cascadedModel = map['ai_model'] || undefined
  const modelWasOverridden = cascadedModel !== globalModel
  const rawModel = modelWasOverridden ? cascadedModel : (globalCustomModel || globalModel || undefined)
  const finalModel = rawModel === 'custom' ? undefined : rawModel

  // Inject scheduler MCP server (Claude SDK only)
  const sdkBackend = map['ai_sdkBackend'] || 'claude-agent-sdk'
  if (sdkBackend === 'claude-agent-sdk' && opts?.getSchedulerMcpConfig) {
    const schedulerMcp = opts.getSchedulerMcpConfig(conversationId)
    if (schedulerMcp) {
      mcpServers['agent_scheduler'] = schedulerMcp as any
    }
  }

  return {
    sdkBackend: (map['ai_sdkBackend'] || 'claude-agent-sdk') as string,
    model: finalModel,
    maxTurns: map['ai_maxTurns'] ? Number(map['ai_maxTurns']) : undefined,
    maxThinkingTokens: map['ai_maxThinkingTokens'] ? Number(map['ai_maxThinkingTokens']) : undefined,
    maxBudgetUsd: map['ai_maxBudgetUsd'] ? Number(map['ai_maxBudgetUsd']) : undefined,
    cwd: getConversationCwd(db, conversationId, sessionsBase),
    tools,
    permissionMode: map['ai_permissionMode'] || 'bypassPermissions',
    requirePlanApproval: (map['ai_requirePlanApproval'] ?? 'true') === 'true',
    mcpServers: filterMcpServers(mcpServers, map['ai_mcpDisabled']),
    cwdRestrictionEnabled: (map['hooks_cwdRestriction'] ?? 'true') === 'true',
    cwdWhitelist,
    sharedHooks: (map['settings_sharedAcrossBackends'] ?? 'true') === 'true',
    skills: (map['ai_skills'] as 'off' | 'user' | 'project' | 'local') || 'off',
    skillsEnabled: (map['ai_skillsEnabled'] ?? 'true') === 'true',
    disabledSkills: safeJsonParse<string[]>(map['ai_disabledSkills'] || '[]', []),
    skillsIncludePlugins: (map['ai_skillsIncludePlugins'] ?? 'false') === 'true',
    apiKey: globalApiKey,
    baseUrl: globalBaseUrl,
    ttsResponseMode: (map['tts_responseMode'] as 'off' | 'full' | 'summary' | 'auto') || undefined,
    ttsAutoWordLimit: map['tts_autoWordLimit'] ? Number(map['tts_autoWordLimit']) : undefined,
    ttsSummaryPrompt: map['tts_summaryPrompt'] || undefined,
    ttsSummaryModel: map['tts_summaryModel'] || undefined,
    compactModel: map['ai_compactModel'] || undefined,
    titleModel: map['ai_titleModel'] || undefined,
    piDisabledExtensions: safeJsonParse<string[]>(map['pi_disabledExtensions'] || '[]', []),
    piExtensionsDir: globalPiExtensionsDir,
    webhookCompletionUrl: map['webhook_completionUrl'] || undefined,
  }
}

// ─── Message Persistence ──────────────────────────────────────

export function saveMessage(
  db: SqlJsAdapter,
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  attachments: Attachment[] = [],
  toolCalls?: ToolCall[]
): Message {
  const now = new Date().toISOString()
  const toolCallsJson = toolCalls?.length ? JSON.stringify(toolCalls) : null
  const result = (db as any)
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(conversationId, role, content, JSON.stringify(attachments), toolCallsJson, now, now)

  return {
    id: result.lastInsertRowid as number,
    conversation_id: conversationId,
    role,
    content,
    attachments: JSON.stringify(attachments),
    tool_calls: toolCallsJson,
    created_at: now,
    updated_at: now,
  }
}

// ─── SDK Session CRUD ─────────────────────────────────────────

function getConversationSdkSessionId(db: SqlJsAdapter, conversationId: number): string | null {
  const row = (db as any).prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(conversationId) as { sdk_session_id: string | null } | undefined
  return row?.sdk_session_id ?? null
}

function saveConversationSdkSessionId(db: SqlJsAdapter, conversationId: number, sessionId: string): void {
  (db as any).prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run(sessionId, conversationId)
}

function clearConversationSdkSessionId(db: SqlJsAdapter, conversationId: number): void {
  (db as any).prepare('UPDATE conversations SET sdk_session_id = NULL WHERE id = ?').run(conversationId)
}

function saveConversationUsage(
  db: SqlJsAdapter,
  conversationId: number,
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    context_window?: number
  }
): void {
  (db as any).prepare(
    `UPDATE conversations SET
       last_input_tokens = ?,
       last_output_tokens = ?,
       last_cache_read_tokens = ?,
       last_cache_creation_tokens = ?,
       last_context_window = ?,
       last_usage_updated_at = ?
     WHERE id = ?`
  ).run(
    usage.input_tokens ?? null,
    usage.output_tokens ?? null,
    usage.cache_read_input_tokens ?? null,
    usage.cache_creation_input_tokens ?? null,
    usage.context_window ?? null,
    new Date().toISOString(),
    conversationId
  )
}

function updateConversationTimestamp(db: SqlJsAdapter, conversationId: number): void {
  (db as any).prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conversationId
  )
}

// ─── Last User Message ────────────────────────────────────────

function buildLastUserMessage(
  db: SqlJsAdapter,
  conversationId: number
): Array<{ role: Message['role']; content: string }> {
  const row = (db as any).prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(conversationId) as Pick<Message, 'role' | 'content'> | undefined
  return row ? [{ role: row.role, content: row.content }] : []
}

// ─── Stream and Save ──────────────────────────────────────────

async function streamAndSave(
  db: SqlJsAdapter,
  conversationId: number,
  options: MessagesHandlerOptions
): Promise<Message | null> {
  options.onTtsStop?.()

  const generation = (streamGenerations.get(conversationId) ?? 0) + 1
  streamGenerations.set(conversationId, generation)

  const sdkSessionId = getConversationSdkSessionId(db, conversationId)
  const messages = sdkSessionId
    ? buildLastUserMessage(db, conversationId)
    : buildMessageHistory(db, conversationId)

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const systemPrompt = await getSystemPrompt(db, conversationId, aiSettings.cwd!, {
    knowledgesDir: options.knowledgesDir,
    supportedKnowledgeExts: options.supportedKnowledgeExts,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })

  // Run UserPromptSubmit hooks
  const isClaudeBackend = aiSettings.sdkBackend !== 'pi'
  const runHooks = isClaudeBackend || aiSettings.sharedHooks !== false
  let hookSystemContents: string[] = []
  const lastUserMsg = messages[messages.length - 1]
  if (runHooks && lastUserMsg?.role === 'user') {
    const hookMessages = await options.hookRunner.runUserPromptSubmitHooks(
      lastUserMsg.content,
      aiSettings.cwd || process.cwd(),
      aiSettings.permissionMode || 'bypassPermissions'
    )
    const convExtra = { conversationId }
    for (const msg of hookMessages) {
      sendChunk('system_message', msg.content, {
        hookEvent: msg.hookEvent,
        ...convExtra,
      })
      hookSystemContents.push(msg.content)
    }
  }

  const retrySettings = readRetrySettings(db)
  const maxAttempts = retrySettings.enabled ? retrySettings.maxAttempts : 1
  const convExtra = { conversationId }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (streamGenerations.get(conversationId) !== generation) return null

    const attemptSessionId = attempt === 1 ? sdkSessionId : null
    const attemptMessages = attempt === 1
      ? messages
      : buildMessageHistory(db, conversationId)

    try {
      const result = await streamMessage(
        attemptMessages, systemPrompt, aiSettings, conversationId, attemptSessionId
      )
      const { content: responseContent, toolCalls, aborted, sessionId: newSessionId, error } = result
      const stopReason = (result as any).stopReason as string | undefined
      const usage = (result as any).usage as {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
        context_window?: number
      } | undefined

      // Persist token usage so the /context command and status-line indicator have live data.
      if (usage) {
        try {
          saveConversationUsage(db, conversationId, usage)
          notifyConversationUpdated(conversationId)
        } catch (e) { console.warn('[messages] saveConversationUsage:', e) }
      }

      if (aborted) return null

      if (responseContent) {
        if (newSessionId) {
          saveConversationSdkSessionId(db, conversationId, newSessionId)
        }
        const exists = (db as any).prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)
        if (!exists) return null

        const finalContent = hookSystemContents.length > 0
          ? hookSystemContents.map(c => `<hook-system-message>${c}</hook-system-message>`).join('\n') + '\n\n' + responseContent
          : responseContent
        const assistantMsg = saveMessage(db, conversationId, 'assistant', finalContent, [], toolCalls)
        updateConversationTimestamp(db, conversationId)
        notifyConversationUpdated(conversationId)

        // Fire-and-forget: webhook notification
        if (aiSettings.webhookCompletionUrl && options.onWebhookFire) {
          const convTitle = ((db as any).prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId) as { title: string } | undefined)?.title ?? ''
          try {
            options.onWebhookFire(aiSettings.webhookCompletionUrl, {
              event: error ? 'completion_with_error' : 'completion',
              conversationId,
              conversationTitle: convTitle,
              messageId: assistantMsg.id,
              content: responseContent,
              model: aiSettings.model || '',
              stopReason,
              createdAt: assistantMsg.created_at,
              ...(error ? { error } : {}),
            })
          } catch (err) {
            console.error('[messages] Webhook error:', err)
          }
        }

        // Fire-and-forget: TTS
        if (!error && options.onTtsSpeak) {
          try {
            options.onTtsSpeak(responseContent, conversationId, aiSettings)
          } catch (err) {
            console.error('[tts] Response TTS error:', err)
          }
        }

        return assistantMsg
      }

      if (!error) return null

      // Error with no content — retry or emit final error
      if (attemptSessionId) {
        clearConversationSdkSessionId(db, conversationId)
      }
      options.onSessionInvalidate?.(conversationId)

      if (attempt < maxAttempts) {
        const delay = retrySettings.initialDelayMs * Math.pow(2, attempt - 1)
        console.warn(`[messages] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, error)
        sendChunk('retry', `Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxAttempts})...`, {
          ...convExtra,
          retryAttempt: attempt + 1,
          retryMaxAttempts: maxAttempts,
          retryDelayMs: delay,
        })
        await sleep(delay)
        if (streamGenerations.get(conversationId) !== generation) return null
        continue
      }

      sendChunk('error', error, convExtra)
      return null
    } catch (err) {
      if (attempt === 1 && sdkSessionId) {
        console.warn('[messages] SDK session resume failed, retrying with full history:', err instanceof Error ? err.message : String(err))
        clearConversationSdkSessionId(db, conversationId)
        options.onSessionInvalidate?.(conversationId)
        continue
      }
      console.error('[messages] Stream error:', err instanceof Error ? err.message : String(err))
      return null
    }
  }

  return null
}

// ─── Title Generation ─────────────────────────────────────────

async function generateConversationTitle(
  db: SqlJsAdapter,
  conversationId: number,
  userContent: string,
  assistantContent: string,
  options: MessagesHandlerOptions
): Promise<void> {
  const cleanAssistant = assistantContent
    .replace(/<hook-system-message>[\s\S]*?<\/hook-system-message>\n?/g, '')
    .trimStart()
  const userSnippet = userContent.slice(0, 200)
  const assistantSnippet = cleanAssistant.slice(0, 200)

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const effectiveModel = aiSettings.titleModel || aiSettings.model || HAIKU_MODEL
  const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

  try {
    const rawTitle = await summarizeWithModel(
      `Generate a very short title (3-6 words) for this conversation. Reply with ONLY the title — no quotes, no explanation.\nUser: ${userSnippet}\nAssistant: ${assistantSnippet}`,
      effectiveModel,
      { cwd: aiSettings.cwd || process.cwd(), apiKey: aiSettings.apiKey, baseUrl: aiSettings.baseUrl },
    )

    const title = rawTitle.trim().replace(/^["']|["']$/g, '').slice(0, 80)

    if (!title) {
      console.warn('[messages] Auto-title: empty title generated for conversation', conversationId)
      return
    }

    console.log('[messages] Auto-title:', title, 'for conversation', conversationId)
    ;(db as any).prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)

    options.broadcaster.broadcast('conversations:titleUpdated', { id: conversationId, title })
  } finally {
    restoreEnv?.()
  }
}

// ─── Compact Conversation ─────────────────────────────────────

export async function compactConversation(
  db: SqlJsAdapter,
  conversationId: number,
  options: MessagesHandlerOptions
): Promise<{ summary: string; clearedAt: string }> {
  const history = buildMessageHistory(db, conversationId)
  if (history.length === 0) {
    const clearedAt = new Date().toISOString()
    ;(db as any).prepare('UPDATE conversations SET cleared_at = ?, compact_summary = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, clearedAt, conversationId)
    return { summary: '', clearedAt }
  }

  const conversationText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const aiSettings = getAISettings(db, conversationId, {
    sessionsBase: options.sessionsBase,
    knowledgesDir: options.knowledgesDir,
    getSchedulerMcpConfig: options.getSchedulerMcpConfig,
  })
  const effectiveModel = aiSettings.compactModel || aiSettings.model || HAIKU_MODEL
  const restoreEnv = injectApiKeyEnv(aiSettings.apiKey, aiSettings.baseUrl)

  try {
    const summary = await summarizeWithModel(
      `Summarize the following conversation into a concise context summary that preserves all key information, decisions, code changes, file paths, and important details. The summary will replace the full conversation history, so it must capture everything needed to continue the conversation seamlessly. Write the summary as a factual recap, not as a conversation. Do NOT wrap it in quotes or add a preamble.\n\n${conversationText}`,
      effectiveModel,
      { cwd: aiSettings.cwd || process.cwd(), apiKey: aiSettings.apiKey, baseUrl: aiSettings.baseUrl },
    )

    const clearedAt = new Date().toISOString()
    ;(db as any).prepare('UPDATE conversations SET cleared_at = ?, compact_summary = ?, sdk_session_id = NULL, updated_at = ? WHERE id = ?')
      .run(clearedAt, summary || null, clearedAt, conversationId)
    options.onSessionInvalidate?.(conversationId)

    return { summary, clearedAt }
  } finally {
    restoreEnv?.()
  }
}

// ─── Handler Registration ─────────────────────────────────────

export function registerMessagesHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: MessagesHandlerOptions
): void {
  registrar.handle(
    'messages:send',
    async (_event, conversationId: unknown, content: unknown, attachments?: unknown) => {
      const validConvId = validatePositiveInt(conversationId, 'conversationId')
      const validContent = validateString(content, 'content', 10_000_000)
      const atts = attachments as Attachment[] | undefined

      const cwd = getConversationCwd(db, validConvId, options.sessionsBase)
      let finalContent = validContent
      let savedAttachments = atts
      if (atts?.length) {
        const { copied, contentSuffix } = await copyAttachmentsToSession(cwd, atts)
        savedAttachments = copied
        finalContent = validContent + contentSuffix
      }

      saveMessage(db, validConvId, 'user', finalContent, savedAttachments)
      updateConversationTimestamp(db, validConvId)

      const assistantMsg = await streamAndSave(db, validConvId, options)

      // Auto-title on first assistant response (skip Quick Chat)
      if (assistantMsg) {
        const quickChatRow = (db as any).prepare("SELECT value FROM settings WHERE key = 'quickChat_conversationId'").get() as { value: string } | undefined
        const isQuickChat = quickChatRow?.value === String(validConvId)
        if (!isQuickChat) {
          const assistantCount = (db as any).prepare(
            "SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND role = 'assistant'"
          ).get(validConvId) as { c: number }
          if (assistantCount.c === 1) {
            generateConversationTitle(db, validConvId, validContent, assistantMsg.content, options)
              .catch(err => console.error('[messages] Auto-title error:', err))
          }
        }
      }

      return assistantMsg
    }
  )

  registrar.handle('messages:compact', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')
    return compactConversation(db, validConvId, options)
  })

  registrar.handle('messages:stop', async (_event, conversationId?: unknown) => {
    if (conversationId != null) {
      validatePositiveInt(conversationId, 'conversationId')
      invalidateRetry(conversationId as number)
    }
    abortStream(conversationId as number | undefined)
  })

  registrar.handle(
    'messages:respondToApproval',
    async (_event, requestId: unknown, response: unknown) => {
      respondToApproval(requestId as string, response as ToolApprovalResponse | AskUserResponse)
    }
  )

  registrar.handle('messages:regenerate', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')

    const lastAssistant = (db as any)
      .prepare(
        `SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(validConvId) as { id: number } | undefined

    if (lastAssistant) {
      (db as any).prepare('DELETE FROM messages WHERE id = ?').run(lastAssistant.id)
    }

    clearConversationSdkSessionId(db, validConvId)
    options.onSessionInvalidate?.(validConvId)
    updateConversationTimestamp(db, validConvId)

    return streamAndSave(db, validConvId, options)
  })

  registrar.handle('messages:edit', async (_event, messageId: unknown, content: unknown) => {
    const validMsgId = validatePositiveInt(messageId, 'messageId')
    const validContent = validateString(content, 'content', 10_000_000)

    const msg = (db as any)
      .prepare('SELECT id, conversation_id, created_at FROM messages WHERE id = ?')
      .get(validMsgId) as { id: number; conversation_id: number; created_at: string } | undefined

    if (!msg) throw new Error('Message not found')

    ;(db as any).transaction(() => {
      (db as any).prepare('UPDATE messages SET content = ?, updated_at = ? WHERE id = ?').run(
        validContent,
        new Date().toISOString(),
        validMsgId
      )
      ;(db as any).prepare(
        'DELETE FROM messages WHERE conversation_id = ? AND id > ?'
      ).run(msg.conversation_id, msg.id)
      ;(db as any).prepare('UPDATE conversations SET sdk_session_id = NULL WHERE id = ?').run(msg.conversation_id)
    })()
    options.onSessionInvalidate?.(msg.conversation_id)

    updateConversationTimestamp(db, msg.conversation_id)

    return streamAndSave(db, msg.conversation_id, options)
  })

  registrar.handle('conversations:generateTitle', async (_event, conversationId: unknown) => {
    const validConvId = validatePositiveInt(conversationId, 'conversationId')

    const firstUser = (db as any).prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1"
    ).get(validConvId) as { content: string } | undefined

    const firstAssistant = (db as any).prepare(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY created_at ASC LIMIT 1"
    ).get(validConvId) as { content: string } | undefined

    if (!firstUser) return

    await generateConversationTitle(
      db,
      validConvId,
      firstUser.content,
      firstAssistant?.content || '',
      options
    )
  })
}
