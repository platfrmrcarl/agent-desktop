/**
 * TaskRunContext implementation for headless mode.
 * Uses direct DB queries and the Claude Agent SDK — no Electron dependencies.
 */

import { join } from 'path'
import { mkdirSync, appendFileSync } from 'fs'
import { homedir } from 'os'
import { spawn } from 'child_process'
import type Database from 'better-sqlite3'
import type { TaskRunContext, StreamResult } from '../core/services/taskExecutor'
import type { AISettings } from '../core/services/streaming'
import { loadAgentSDK } from '../core/services/anthropic'
import type { ToolCall, CwdWhitelistEntry } from '../core/types'
import { getSessionsBase, getKnowledgesDir } from './headlessEnv'

const LOG_PATH = join(homedir(), '.config', 'agent-desktop', 'scheduler-headless.log')

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stderr.write(line)
  try {
    appendFileSync(LOG_PATH, line)
  } catch { /* log dir may not exist yet */ }
}

// ─── Pure DB helpers (replicated from main/services/messages.ts) ─────

function buildMessageHistory(db: Database.Database, conversationId: number, limit = 100): Array<{ role: 'user' | 'assistant'; content: string }> {
  const conv = db.prepare('SELECT cleared_at, compact_summary FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null; compact_summary: string | null } | undefined

  let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
  const params: (number | string)[] = [conversationId]

  if (conv?.cleared_at) {
    query += ' AND created_at > ?'
    params.push(conv.cleared_at)
  }

  query += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const rows = db.prepare(query).all(...params) as { role: 'user' | 'assistant'; content: string }[]

  const result = rows.reverse().map(row => ({ role: row.role, content: row.content }))

  if (conv?.compact_summary) {
    result.unshift({ role: 'assistant', content: `[Previous conversation summary]\n${conv.compact_summary}` })
  }

  return result
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T } catch { return fallback }
}

function getFolderOverrides(db: Database.Database, folderId: number): Record<string, string> {
  const row = db.prepare('SELECT ai_overrides FROM folders WHERE id = ?').get(folderId) as { ai_overrides: string | null } | undefined
  return row?.ai_overrides ? safeJsonParse<Record<string, string>>(row.ai_overrides, {}) : {}
}

function getConversationCwd(db: Database.Database, conversationId: number): string {
  const row = db.prepare('SELECT cwd FROM conversations WHERE id = ?').get(conversationId) as { cwd: string | null } | undefined
  const cwd = row?.cwd || join(getSessionsBase(), String(conversationId))
  mkdirSync(cwd, { recursive: true })
  return cwd
}

function getAISettingsFromDb(db: Database.Database, conversationId: number): AISettings {
  const keys = ['ai_model', 'ai_maxTurns', 'ai_maxThinkingTokens', 'ai_maxBudgetUsd', 'ai_permissionMode', 'ai_tools', 'hooks_cwdRestriction', 'hooks_cwdWhitelist', 'ai_knowledgeFolders', 'ai_skills', 'ai_skillsEnabled', 'ai_disabledSkills', 'ai_apiKey', 'ai_baseUrl', 'ai_customModel']
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all(...keys) as { key: string; value: string }[]

  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value

  const globalApiKey = map['ai_apiKey'] || undefined
  const globalBaseUrl = map['ai_baseUrl'] || undefined
  const globalCustomModel = map['ai_customModel'] || undefined
  const globalModel = map['ai_model'] || undefined

  // Cascade: folder → conversation overrides
  const convRow = db.prepare('SELECT folder_id, ai_overrides FROM conversations WHERE id = ?')
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

  // CWD whitelist
  const cwdWhitelist = safeJsonParse<CwdWhitelistEntry[]>(map['hooks_cwdWhitelist'] || '[]', [])

  // Knowledge folders → whitelist
  const kfRaw = map['ai_knowledgeFolders']
  const knowledgeFolders = kfRaw ? safeJsonParse<{ folder: string; access: string }[]>(kfRaw, []) : []
  const knowledgesDir = getKnowledgesDir()
  for (const sel of knowledgeFolders) {
    if (!sel.folder?.length || sel.folder.includes('..') || sel.folder.includes('/')) continue
    const resolved = join(knowledgesDir, sel.folder)
    cwdWhitelist.push({ path: resolved, access: sel.access === 'readwrite' ? 'readwrite' : 'read' })
  }

  // Tools
  const toolsValue = map['ai_tools'] || 'preset:claude_code'
  const tools: AISettings['tools'] = toolsValue === 'preset:claude_code'
    ? { type: 'preset', preset: 'claude_code' }
    : (safeJsonParse<string[] | null>(toolsValue, null) ?? { type: 'preset', preset: 'claude_code' })

  // MCP servers
  const mcpRows = db.prepare('SELECT name, type, command, args, env, url, headers FROM mcp_servers WHERE enabled = 1')
    .all() as { name: string; type: string | null; command: string; args: string; env: string; url: string | null; headers: string | null }[]

  const mcpServers: AISettings['mcpServers'] = {}
  for (const row of mcpRows) {
    try {
      const transport = row.type || 'stdio'
      if (transport === 'http' || transport === 'sse') {
        if (!row.url) continue
        const headers = safeJsonParse<Record<string, string>>(row.headers || '{}', {})
        mcpServers[row.name] = { type: transport, url: row.url, ...(Object.keys(headers).length > 0 ? { headers } : {}) }
      } else {
        const args = safeJsonParse<string[]>(row.args, [])
        const env = safeJsonParse<Record<string, string>>(row.env, {})
        mcpServers[row.name] = { command: row.command, args, ...(Object.keys(env).length > 0 ? { env } : {}) }
      }
    } catch (err) {
      log(`Invalid MCP config for ${row.name}: ${err}`)
    }
  }

  // Model
  const cascadedModel = map['ai_model'] || undefined
  const modelWasOverridden = cascadedModel !== globalModel
  const rawModel = modelWasOverridden ? cascadedModel : (globalCustomModel || globalModel || undefined)
  const finalModel = rawModel === 'custom' ? undefined : rawModel

  return {
    model: finalModel,
    maxTurns: map['ai_maxTurns'] ? Number(map['ai_maxTurns']) : undefined,
    maxThinkingTokens: map['ai_maxThinkingTokens'] ? Number(map['ai_maxThinkingTokens']) : undefined,
    maxBudgetUsd: map['ai_maxBudgetUsd'] ? Number(map['ai_maxBudgetUsd']) : undefined,
    cwd: getConversationCwd(db, conversationId),
    tools,
    permissionMode: 'bypassPermissions',
    mcpServers,
    cwdRestrictionEnabled: (map['hooks_cwdRestriction'] ?? 'true') === 'true',
    cwdWhitelist,
    apiKey: globalApiKey,
    baseUrl: globalBaseUrl,
  }
}

function getSystemPromptFromDb(db: Database.Database, conversationId: number, cwd: string): string {
  const cwdDirective = `Your working directory is ${cwd}. Use absolute paths for all file operations.`

  const row = db.prepare('SELECT system_prompt, folder_id, ai_overrides FROM conversations WHERE id = ?')
    .get(conversationId) as { system_prompt: string | null; folder_id: number | null; ai_overrides: string | null } | undefined

  if (row?.system_prompt) return `${cwdDirective}\n\n${row.system_prompt}`

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
    const globalRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_defaultSystemPrompt'").get() as { value: string } | undefined
    cascadedPrompt = globalRow?.value || undefined
  }

  return cascadedPrompt ? `${cwdDirective}\n\n${cascadedPrompt}` : cwdDirective
}

// ─── Headless streaming (direct SDK call) ──────────────────

function buildPromptWithHistory(messages: Array<{ role: string; content: string }>): string {
  const lastMessage = messages[messages.length - 1]
  const prompt = lastMessage?.content ?? ''

  if (messages.length <= 1) return prompt

  const historyParts: string[] = []
  for (const msg of messages.slice(0, -1)) {
    historyParts.push(`<msg role="${msg.role}">${msg.content}</msg>`)
  }

  return `<conversation_history>\n${historyParts.join('\n')}\n</conversation_history>\n\n${prompt}`
}

async function headlessStreamMessage(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  aiSettings: AISettings,
  conversationId: number
): Promise<StreamResult> {
  // Inject API key env if configured
  const savedApiKey = process.env.ANTHROPIC_API_KEY
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
  if (aiSettings.apiKey) {
    process.env.ANTHROPIC_API_KEY = aiSettings.apiKey
    if (aiSettings.baseUrl) process.env.ANTHROPIC_BASE_URL = aiSettings.baseUrl
    else delete process.env.ANTHROPIC_BASE_URL
  }

  try {
    const sdk = await loadAgentSDK()
    const abortController = new AbortController()

    let fullContent = ''
    const toolCallsMap = new Map<string, ToolCall>()
    const toolInputAccum = new Map<string, string>()
    let currentToolBlockId: string | null = null

    const queryOptions: Record<string, unknown> = {
      model: aiSettings.model || undefined,
      systemPrompt: systemPrompt || undefined,
      maxTurns: aiSettings.maxTurns || undefined,
      maxThinkingTokens: aiSettings.maxThinkingTokens || undefined,
      maxBudgetUsd: aiSettings.maxBudgetUsd || undefined,
      cwd: aiSettings.cwd || undefined,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      abortController,
      persistSession: false,
    }

    if (aiSettings.tools) queryOptions.tools = aiSettings.tools

    if (aiSettings.mcpServers && Object.keys(aiSettings.mcpServers).length > 0) {
      queryOptions.mcpServers = aiSettings.mcpServers
      queryOptions.allowedTools = Object.keys(aiSettings.mcpServers).map(name => `mcp__${name}__*`)
    }

    const prompt = buildPromptWithHistory(messages)
    const agentQuery = sdk.query({ prompt, options: queryOptions })

    for await (const message of agentQuery) {
      const msg = message as Record<string, unknown>

      // assistant messages: contain the AI's text and tool_use blocks
      if (msg.type === 'assistant') {
        const assistantMsg = msg as { message?: { content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> } }
        const content = assistantMsg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              fullContent += block.text
            } else if (block.type === 'tool_use' && block.id && block.name) {
              toolCallsMap.set(block.id, {
                id: block.id,
                name: block.name,
                input: JSON.stringify(block.input || {}),
                output: '',
                status: 'done',
              })
            }
          }
        }
      }

      // user messages with tool_use_result: capture tool outputs
      if (msg.type === 'user') {
        const userMsg = msg as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string | Array<{ text?: string }> }> } }
        const content = userMsg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id && toolCallsMap.has(block.tool_use_id)) {
              const tc = toolCallsMap.get(block.tool_use_id)!
              if (typeof block.content === 'string') {
                tc.output = block.content.slice(0, 50_000)
              } else if (Array.isArray(block.content)) {
                tc.output = block.content.map(c => c.text || '').join('\n').slice(0, 50_000)
              }
            }
          }
        }
      }

      // result: final SDK completion status
      if (msg.type === 'result') {
        const resultMsg = msg as { result?: string; subtype?: string }
        if (resultMsg.result && !fullContent) {
          fullContent = resultMsg.result
        }
      }

      // stream_event: streaming mode fallback (persistent sessions)
      if (msg.type === 'stream_event') {
        const event = msg.event as { type?: string; delta?: { type: string; text?: string; partial_json?: string }; content_block?: { type: string; name?: string; id?: string } } | undefined

        if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const toolId = event.content_block.id || `tool_${Date.now()}`
          const toolName = event.content_block.name || 'tool'
          currentToolBlockId = toolId
          toolInputAccum.set(toolId, '')
          toolCallsMap.set(toolId, { id: toolId, name: toolName, input: '{}', output: '', status: 'done' })
        } else if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          fullContent += event.delta.text
        }

        if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta' && currentToolBlockId) {
          const existing = toolInputAccum.get(currentToolBlockId) || ''
          toolInputAccum.set(currentToolBlockId, existing + (event.delta.partial_json || ''))
        }
      }
    }

    log(`[stream] Conversation ${conversationId}: ${fullContent.length} chars, ${toolCallsMap.size} tool calls`)

    return {
      content: fullContent,
      toolCalls: Array.from(toolCallsMap.values()),
      aborted: false,
      sessionId: null,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log(`[stream] Error in conversation ${conversationId}: ${errorMsg}`)
    return {
      content: '',
      toolCalls: [],
      aborted: false,
      sessionId: null,
      error: errorMsg,
    }
  } finally {
    // Restore env
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey
    else delete process.env.ANTHROPIC_API_KEY
    if (savedBaseUrl !== undefined) process.env.ANTHROPIC_BASE_URL = savedBaseUrl
    else delete process.env.ANTHROPIC_BASE_URL
  }
}

// ─── Headless notifications ────────────────────────────────

async function headlessNotify(title: string, body: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform === 'linux') {
      const child = spawn('notify-send', [title, body.slice(0, 200)], { stdio: 'ignore' })
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    } else if (process.platform === 'darwin') {
      const child = spawn('osascript', ['-e', `display notification "${body.slice(0, 200).replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`], { stdio: 'ignore' })
      child.on('close', () => resolve())
      child.on('error', () => resolve())
    } else {
      // Windows: skip for now (powershell toast is complex)
      resolve()
    }
  })
}

// ─── Factory ───────────────────────────────────────────────

export function createHeadlessContext(db: Database.Database): TaskRunContext {
  return {
    buildHistory(conversationId) {
      return buildMessageHistory(db, conversationId)
    },
    getAISettings(conversationId) {
      return getAISettingsFromDb(db, conversationId)
    },
    async getSystemPrompt(conversationId, cwd) {
      return getSystemPromptFromDb(db, conversationId, cwd)
    },
    async streamMessage(history, systemPrompt, aiSettings, conversationId) {
      return headlessStreamMessage(history, systemPrompt, aiSettings, conversationId)
    },
    saveMessage(conversationId, role, content, _attachments, toolCalls) {
      const now = new Date().toISOString()
      const toolCallsJson = toolCalls?.length ? JSON.stringify(toolCalls) : null
      db.prepare(
        'INSERT INTO messages (conversation_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(conversationId, role, content, toolCallsJson, now)
      // Update conversation timestamp
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId)
    },
    async notify(title, body) {
      await headlessNotify(title, body)
    },
    onTaskUpdate(task) {
      log(`[task] ${task.name} (id=${task.id}): ${task.last_status}`)
    },
    onConversationsRefresh() {
      // No renderer to refresh in headless mode
    },
  }
}
