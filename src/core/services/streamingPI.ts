import {
  sendChunk,
  buildPromptWithHistory,
  abortControllers,
  pendingRequests,
  denyPendingForConversation,
  getPIUIWindowProvider,
  getPISchedulerBridge,
} from './streaming'
import { gatePiTools } from './piPermissionGate'
import { createCanUseTool } from './canUseTool'
import { createMcpClient, McpConnectError, type McpClientHandle } from './mcpClient'
import { mcpServerToPiTools } from './mcpToPiTools'
import { loadPISdk } from '../../main/services/piSdk'
import { PiUIContext } from './piUIContext'
import { registerPiUIContext, unregisterPiUIContext } from './piUIRegistry'
import { existsSync } from 'node:fs'
import { getConversationPiSessionFile, setConversationPiSessionFile } from '../handlers/messages'
import { getDatabase } from '../db/database'
import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'
import type { AISettings } from './streaming'
import type { ToolCall } from '../../shared/types'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import { createBridge, type ExtensionRuntimeContext } from './piExtensionBridge'
import parityFactory from '../../extensions/agent-desktop-parity'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import type { CwdWhitelistEntry } from '../types'
import {
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  isPathOutsideAllowed,
  extractBashReadPaths,
  extractBashWritePaths,
} from './cwdHooks'
import type { CanUseToolFn } from './canUseTool'

// Tool parameters schema for scheduler tool
const SchedulerToolParams = /* #__PURE__ */ (() =>
  Type.Object({
    conversation_id: Type.Number({ description: 'Conversation ID for the task', minimum: 1 }),
    command: Type.String({ description: 'Command to execute: "create", "list", or "cancel"' }),
    name: Type.Optional(Type.String({ description: 'Task name (for create)' })),
    prompt: Type.Optional(Type.String({ description: 'Task prompt (for create)' })),
    interval_value: Type.Optional(Type.Integer({ description: 'Interval value in units (for create)', minimum: 1 })),
    interval_unit: Type.Optional(Type.String({ description: 'Interval unit: minutes/hours/days (for create)' })),
    schedule_time: Type.Optional(Type.String({ description: 'Schedule time HH:MM (for create)' })),
    max_runs: Type.Optional(Type.Integer({ description: 'Max runs (for create)', minimum: 1 })),
    task_id: Type.Optional(Type.Integer({ description: 'Task ID (for cancel)', minimum: 1 })),
  }))()

interface SchedulerToolParams extends Static<typeof SchedulerToolParams> {}

interface SchedulerBridgeResponse {
  id?: number
  name?: string
  next_run_at?: string
  max_runs?: number | null
  deleted?: boolean
  result?: unknown[]
  error?: string
}

interface SchedulerTask {
  id: number
  name: string
  prompt: string
  enabled: boolean
  interval_value: number
  interval_unit: string
  max_runs: number | null
  next_run_at: string
  last_status: string
  run_count: number
}

// Execute command via scheduler bridge socket
async function executeSchedulerCommand(
  conversationId: number,
  command: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const bridge = getPISchedulerBridge()
  const schedSocketPath = bridge?.getSocketPath() ?? null
  const schedAuthToken = bridge?.getAuthToken() ?? null
  if (!schedSocketPath || !schedAuthToken) {
    throw new Error('Scheduler bridge not started')
  }

  const net = await import('net')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(schedSocketPath, () => {
      const request = JSON.stringify({
        method: `scheduler.${command}`,
        token: schedAuthToken,
        params: { conversation_id: conversationId, ...params },
      })
      socket.write(request + '\n')
    })

    let buffer = ''
    let resolved = false

    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const response = JSON.parse(trimmed) as SchedulerBridgeResponse
          if (!resolved) {
            resolved = true
            if (response.error) {
              reject(new Error(response.error))
            } else {
              resolve(response)
            }
          }
        } catch {
          // Continue accumulating
        }
      }
    })

    socket.on('error', (err) => {
      if (!resolved) {
        reject(err)
      }
    })

    socket.on('close', () => {
      if (!resolved) {
        resolve(null)
      }
    })

    // Timeout after 5 seconds
    socket.setTimeout(5000, () => {
      socket.destroy()
      if (!resolved) {
        resolved = true
        reject(new Error('Scheduler bridge timeout'))
      }
    })
  })
}

// Create PI tool definition for scheduler
function createSchedulerTool(): ToolDefinition {
  return {
    name: 'agent_scheduler',
    label: 'Agent Scheduler',
    description: 'Schedule tasks to run at specific times or intervals. Use this tool to create, list, or cancel scheduled tasks for the current conversation.',
    parameters: SchedulerToolParams,
    async execute(_toolCallId, params: SchedulerToolParams, _signal, _onUpdate, _ctx): Promise<AgentToolResult> {
      const result = await executeSchedulerCommand(params.conversation_id, params.command, {
        name: params.name,
        prompt: params.prompt,
        interval_value: params.interval_value,
        interval_unit: params.interval_unit,
        schedule_time: params.schedule_time,
        max_runs: params.max_runs,
        task_id: params.task_id,
      })

      // Format result for display
      if (params.command === 'list' && Array.isArray(result)) {
        const tasks = result as SchedulerTask[]
        const formatted = tasks.map((t) => {
          const nextRun = t.next_run_at ? new Date(t.next_run_at).toLocaleString() : 'N/A'
          return `#${t.id} ${t.enabled ? '✅' : '⏸️'} ${t.name} (${t.interval_value}${t.interval_unit}) - ${nextRun} (run #${t.run_count})`
        })
        return { content: [{ type: 'text', text: formatted.length ? formatted.join('\n') : 'No scheduled tasks' }] }
      } else if (params.command === 'create') {
        const r = result as { id: number; name: string; next_run_at?: string; max_runs?: number | null }
        return {
          content: [{ type: 'text', text: `Task created: ID ${r.id} "${r.name}" (next: ${r.next_run_at ?? 'N/A'})` }],
        }
      } else if (params.command === 'cancel') {
        return { content: [{ type: 'text', text: result && typeof result === 'object' && 'deleted' in result ? 'Task cancelled' : 'Cancel result unknown' }] }
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  }
}

interface MessageParam {
  role: 'user' | 'assistant'
  content: string
}

// Session-scoped key/value stores for the parity extension, keyed by
// conversationId. Persist across multiple streamMessagePI invocations for
// the same conversation (unlike the factory closure, which is rebuilt per
// user message). Used for the dontAsk approval cache and any future
// cross-turn state a module needs.
const sessionStores = new Map<number, Map<string, unknown>>()

function getOrCreateSessionStore(conversationId: number): Map<string, unknown> {
  let store = sessionStores.get(conversationId)
  if (!store) {
    store = new Map<string, unknown>()
    sessionStores.set(conversationId, store)
  }
  return store
}

/** Clear the session store for a conversation (called on /clear, /new, regenerate). */
export function clearExtensionSessionStore(conversationId: number): void {
  sessionStores.delete(conversationId)
}

type PiSdk = Awaited<ReturnType<typeof loadPISdk>>

async function resolveSessionManager(
  pi: PiSdk,
  conversationId: number | undefined,
  cwd: string,
): Promise<{ sessionManager: unknown; persistAfterCreate: () => void }> {
  // No conversationId (one-shot) → in-memory, no persistence
  if (conversationId == null) {
    return {
      sessionManager: pi.SessionManager.inMemory(cwd),
      persistAfterCreate: () => {},
    }
  }

  let db: ReturnType<typeof getDatabase> | null = null
  try {
    db = getDatabase()
  } catch {
    // DB not yet initialised (unlikely in production, but guard for tests)
  }

  if (!db) {
    return {
      sessionManager: pi.SessionManager.inMemory(cwd),
      persistAfterCreate: () => {},
    }
  }

  // Try to resume from an existing file
  const existingFile = getConversationPiSessionFile(db, conversationId)
  if (existingFile && existsSync(existingFile)) {
    try {
      const sm = pi.SessionManager.open(existingFile)
      return { sessionManager: sm, persistAfterCreate: () => {} }
    } catch (err) {
      console.warn(
        '[streamingPI] SessionManager.open failed, falling back to create:',
        err instanceof Error ? err.message : err,
      )
      setConversationPiSessionFile(db, conversationId, null)
      // fall through to create
    }
  }

  // Create fresh — sessionFile is assigned inside newSession() on construction,
  // so getSessionFile() is populated immediately after create() returns.
  const sm = pi.SessionManager.create(cwd)
  const capturedDb = db
  return {
    sessionManager: sm,
    persistAfterCreate: () => {
      const filepath = (sm as { getSessionFile?: () => string | undefined }).getSessionFile?.()
      if (filepath) setConversationPiSessionFile(capturedDb, conversationId, filepath)
    },
  }
}

function mapThinkingLevel(maxThinkingTokens?: number): 'off' | 'low' | 'medium' | 'high' {
  if (!maxThinkingTokens || maxThinkingTokens === 0) return 'off'
  if (maxThinkingTokens <= 10000) return 'low'
  if (maxThinkingTokens <= 50000) return 'medium'
  return 'high'
}

// ─── PI Built-in Tool Hardening ──────────────────────────────────────────────

/** PI tool name → which parameter holds the target path */
const PI_READ_PATH_TOOLS = new Set(['read', 'find', 'grep', 'ls'])
const PI_WRITE_PATH_TOOLS = new Set(['write', 'edit'])

function denyToolResult(message: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text: `Access denied: ${message}` }], details: undefined }
}

/**
 * Wraps pi.codingTools (AgentTool[]) with CWD read/write restriction checks.
 * Mirrors buildCwdRestrictionHooks semantics:
 *   - Write-path enforcement: always active (matches SDK hooks with empty whitelist)
 *   - Read-path enforcement: only when whitelist is non-empty (backward compat per CLAUDE.md)
 * Applied unconditionally — this mirrors the SDK where PreToolUse hooks fire regardless of
 * permissionMode, including bypassPermissions.
 */
function applyCwdRestriction<T extends { name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>(
  tools: T[],
  cwd: string,
  whitelist: CwdWhitelistEntry[],
): T[] {
  const hasWhitelist = whitelist.length > 0
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown): Promise<AgentToolResult<unknown>> {
      const name = tool.name

      // --- Read tools: read, find, grep, ls ---
      if (PI_READ_PATH_TOOLS.has(name) && hasWhitelist) {
        const rawPath = (params.path ?? params.file_path) as string | undefined
        if (rawPath) {
          const outside = isPathOutsideReadAllowed(rawPath, cwd, whitelist)
          if (outside) {
            return denyToolResult(
              `${name} targets "${outside}" which is outside the allowed read directories.`,
            )
          }
        }
      }

      // --- Write tools: write, edit ---
      if (PI_WRITE_PATH_TOOLS.has(name)) {
        const rawPath = (params.path ?? params.file_path) as string | undefined
        if (rawPath) {
          const outside = hasWhitelist
            ? isPathOutsideWriteAllowed(rawPath, cwd, whitelist)
            : isPathOutsideAllowed(rawPath, cwd)
          if (outside) {
            return denyToolResult(
              `${name} targets "${outside}" which is outside the allowed write directories.`,
            )
          }
        }
      }

      // --- Bash: check both write and read paths ---
      if (name === 'bash') {
        const command = params.command as string | undefined
        if (command) {
          // Write-path check (always)
          const writePaths = extractBashWritePaths(command)
          for (const p of writePaths) {
            const outside = hasWhitelist
              ? isPathOutsideWriteAllowed(p, cwd, whitelist)
              : isPathOutsideAllowed(p, cwd)
            if (outside) {
              return denyToolResult(
                `bash write target "${outside}" is outside the allowed write directories.`,
              )
            }
          }
          // Read-path check (only when whitelist is non-empty)
          if (hasWhitelist) {
            const readPaths = extractBashReadPaths(command)
            for (const p of readPaths) {
              const outside = isPathOutsideReadAllowed(p, cwd, whitelist)
              if (outside) {
                return denyToolResult(
                  `bash read target "${outside}" is outside the allowed read directories.`,
                )
              }
            }
          }
        }
      }

      return (tool.execute as (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<AgentToolResult<unknown>>)(toolCallId, params, signal, onUpdate)
    },
  }))
}

/**
 * Gates AgentTool[] (pi.codingTools) through canUseTool permission prompts.
 * Mirrors gatePiTools from piPermissionGate.ts but uses the AgentTool execute signature
 * (4 params: toolCallId, params, signal?, onUpdate?) vs ToolDefinition's 5-param signature.
 * Skipped entirely when bypass is true (bypassPermissions mode).
 */
function gateAgentTools<T extends { name: string; execute: (...args: unknown[]) => Promise<AgentToolResult<unknown>> }>(
  tools: T[],
  canUseTool: CanUseToolFn,
  bypass: boolean,
): T[] {
  if (bypass) return tools
  return tools.map((tool) => ({
    ...tool,
    async execute(toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: unknown): Promise<AgentToolResult<unknown>> {
      if (signal?.aborted) {
        return denyToolResult('aborted before approval')
      }
      let decision
      try {
        decision = await canUseTool(tool.name, params)
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Permission check failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: undefined,
        }
      }
      if (decision.behavior === 'deny') {
        return denyToolResult(decision.message ?? 'denied by user')
      }
      const effectiveParams = decision.updatedInput ?? params
      return (tool.execute as (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => Promise<AgentToolResult<unknown>>)(toolCallId, effectiveParams, signal, onUpdate)
    },
  }))
}

export async function streamMessagePI(
  messages: MessageParam[],
  systemPrompt: string | undefined,
  aiSettings: AISettings | undefined,
  conversationId: number | undefined,
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null; stopReason?: string }> {
  console.log(`[streamingPI] Using PI-SDK backend for conversation ${conversationId}`)
  const pi = await loadPISdk()

  const convKey = conversationId ?? -1
  const convExtra = conversationId != null ? { conversationId } : {}

  let fullContent = ''
  let aborted = false
  const toolCallsMap = new Map<string, ToolCall>()

  // Abort any existing stream for this conversation before starting new one
  const existing = abortControllers.get(convKey)
  if (existing) existing.abort()

  const abortController = new AbortController()
  abortControllers.set(convKey, abortController)

  const mcpHandles: McpClientHandle[] = []

  try {
    sendChunk('text', '', convExtra)

    const thinkingLevel = mapThinkingLevel(aiSettings?.maxThinkingTokens)

    // Build resource loader with extension filtering
    const disabledPaths = new Set(aiSettings?.piDisabledExtensions || [])

    // Runtime context handed to the bundled parity extension via extensionFactories closure.
    // The factory is statically imported above so electron-vite bundles it into out/main/;
    // no runtime file load, no dev/packaged path branching, no dependency on `app`.
    const extensionBridge = createBridge(conversationId ?? -1, { chunkSender: sendChunk })
    const runtimeCtx: ExtensionRuntimeContext = {
      version: 1,
      conversationId: conversationId ?? -1,
      aiSettings: aiSettings ?? ({} as AISettings),
      db: null,  // Phase 0: modules do not query DB; set from injected dependency in Phase 3+
      bridge: extensionBridge,
      sessionStore: getOrCreateSessionStore(conversationId ?? -1),
    }

    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: aiSettings?.cwd || process.cwd(),
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      ...(aiSettings?.piExtensionsDir ? { additionalExtensionPaths: [aiSettings.piExtensionsDir] } : {}),
      extensionFactories: [(piApi: unknown) => parityFactory(piApi as never, runtimeCtx)],
      ...(disabledPaths.size > 0 ? {
        extensionsOverride: (result: { extensions: Array<{ resolvedPath: string }>; [k: string]: unknown }) => ({
          ...result,
          extensions: result.extensions.filter((ext) => !disabledPaths.has(ext.resolvedPath)),
        }),
      } : {}),
    })
    await resourceLoader.reload()

    // Build permission gate (used for both MCP tools and built-in coding tools)
    const resolvedPermissionMode = aiSettings?.permissionMode ?? 'bypassPermissions'
    const bypass = resolvedPermissionMode === 'bypassPermissions'
    const canUseTool = createCanUseTool({
      aiSettings: {
        requirePlanApproval: aiSettings?.requirePlanApproval,
        disabledSkills: aiSettings?.disabledSkills,
      },
      permissionMode: resolvedPermissionMode,
      chunkConversationId: conversationId ?? null,
      pendingRequestsKey: convKey,
      pendingRequests,
      sendChunk: sendChunk,
      // PI backend is event-based; no subprocess stream to suspend during approval
      onApprovalStart: () => {},
      onApprovalEnd: () => {},
    })

    // Build custom tools array (scheduler tool for PI backend)
    const customTools: ToolDefinition[] = []
    const schedulerBridge = getPISchedulerBridge()
    const schedulerConfig = schedulerBridge?.getMcpConfig(convKey) ?? null
    if (schedulerConfig) {
      // M-8: Suppress the scheduler tool during unattended (task executor) execution to prevent
      // recursive task creation. taskExecutor.ts sets requirePlanApproval=false exclusively for
      // unattended runs — the Claude SDK path instead removes 'agent_scheduler' from mcpServers,
      // but that key is only injected for Claude SDK backend (messages.ts:442), so we cannot use
      // the same check here. requirePlanApproval=false is the reliable PI-side signal.
      const isUnattended = aiSettings?.requirePlanApproval === false
      if (!isUnattended && schedulerBridge?.getSocketPath() && schedulerBridge.getAuthToken()) {
        customTools.push(createSchedulerTool())
      }
    }

    // --- MCP native integration ---
    // PI spawns/tears down all MCP servers per turn (no cross-turn handle persistence — see
    // CLAUDE.md gotcha "PI MCP per-turn cost"). On a fresh conversation with multiple Python
    // FastMCP servers this can take 5-15s of cold start before the agent can begin streaming.
    // Without UI feedback the user perceives the conversation as unresponsive and may send a
    // second message — which aborts the in-flight first stream (streamingPI.ts:426) and looks
    // like "first message never replied". Emit start/end status chunks so the wait is visible.
    const mcpServers = aiSettings?.mcpServers ?? {}
    const mcpEntries = Object.entries(mcpServers).filter(([name]) => !name.includes('__'))
    if (mcpEntries.length > 0) {
      const mcpServerNames = mcpEntries.map(([name]) => name)
      sendChunk(
        'system_message',
        `Loading ${mcpServerNames.length} MCP server${mcpServerNames.length === 1 ? '' : 's'}: ${mcpServerNames.join(', ')}…`,
        { hookName: 'mcp', hookEvent: 'spawn_started', ...convExtra },
      )

      const spawnStart = Date.now()
      const spawnResults = await Promise.allSettled(
        mcpEntries.map(async ([name, config]) => ({ name, handle: await createMcpClient(name, config) })),
      )
      const mcpTools: import('@mariozechner/pi-coding-agent').ToolDefinition[] = []
      let okCount = 0
      for (const r of spawnResults) {
        if (r.status === 'fulfilled') {
          mcpHandles.push(r.value.handle)
          mcpTools.push(...mcpServerToPiTools(r.value.handle))
          okCount++
        } else {
          const errMsg = r.reason instanceof McpConnectError
            ? r.reason.message
            : r.reason instanceof Error
              ? r.reason.message
              : String(r.reason)
          sendChunk('system_message', errMsg, {
            hookName: 'mcp',
            hookEvent: 'spawn_failed',
            ...convExtra,
          })
        }
      }

      const elapsedSec = ((Date.now() - spawnStart) / 1000).toFixed(1)
      sendChunk(
        'system_message',
        `MCP ready: ${okCount}/${mcpServerNames.length} server${mcpServerNames.length === 1 ? '' : 's'}, ${mcpTools.length} tool${mcpTools.length === 1 ? '' : 's'} (${elapsedSec}s)`,
        { hookName: 'mcp', hookEvent: 'spawn_complete', ...convExtra },
      )

      // Gate MCP tools — scheduler is a trusted internal customTool and must not go through canUseTool.
      const gatedMcpTools = gatePiTools(mcpTools, { canUseTool, bypass })
      customTools.push(...gatedMcpTools)
    }
    // --- end MCP ---

    // H-5: Apply CWD restriction to built-in coding tools.
    // Mirrors SDK PreToolUse hooks — fires unconditionally (even in bypassPermissions).
    // Empty whitelist = no read restriction (backward compat), write restriction always active.
    const cwdRestricted = applyCwdRestriction(
      pi.codingTools,
      aiSettings?.cwd || process.cwd(),
      (aiSettings?.hooks_cwdWhitelist as CwdWhitelistEntry[] | undefined) ?? [],
    )

    // H-6: Gate built-in coding tools through canUseTool permission prompts.
    // Skipped in bypassPermissions mode (bypass=true).
    const gatedCodingTools = gateAgentTools(cwdRestricted, canUseTool, bypass)

    const { sessionManager, persistAfterCreate } = await resolveSessionManager(
      pi,
      conversationId,
      aiSettings?.cwd || process.cwd(),
    )

    const { session } = await pi.createAgentSession({
      cwd: aiSettings?.cwd || process.cwd(),
      sessionManager,
      thinkingLevel,
      tools: gatedCodingTools,
      customTools,
      resourceLoader,
    })
    persistAfterCreate()

    // Create UI context and bind to session for extension UI support.
    // Window provider is set by the Electron adapter; headless leaves it null
    // and falls back to a no-op sink (extensions still run, UI events are dropped).
    const winProvider = getPIUIWindowProvider()
    const win = winProvider?.() ?? null
    const uiContext = new PiUIContext(
      win ?? { webContents: { send: () => {} }, isDestroyed: () => true },
      convKey
    )
    registerPiUIContext(convKey, uiContext)
    try {
      await session.bindExtensions({ uiContext: uiContext as never })
    } catch (err) {
      console.log('[streamingPI] bindExtensions not available (PI SDK version may not support it)')
    }

    // Wire abort: when our abort controller fires, abort the PI session
    const onAbort = () => {
      session.abort().catch(() => {})
    }
    abortController.signal.addEventListener('abort', onAbort)

    // Subscribe to events and map to StreamChunk protocol
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
        if (ame?.type === 'text_delta' && ame.delta) {
          fullContent += ame.delta
          sendChunk('text', ame.delta, convExtra)
        }
      } else if (event.type === 'tool_execution_start') {
        const te = event as { toolCallId: string; toolName: string; args: unknown }
        const inputJson = JSON.stringify(te.args || {})

        sendChunk('tool_start', te.toolName, {
          toolName: te.toolName,
          toolId: te.toolCallId,
          ...convExtra,
        })

        // PI provides args immediately — send tool_input right after tool_start
        sendChunk('tool_input', undefined, {
          toolId: te.toolCallId,
          toolInput: inputJson,
          ...convExtra,
        })

        toolCallsMap.set(te.toolCallId, {
          id: te.toolCallId,
          name: te.toolName,
          input: inputJson,
          output: '',
          status: 'done',
        })
      } else if (event.type === 'tool_execution_end') {
        const te = event as { toolCallId: string; toolName: string; result: unknown; isError: boolean }
        const output = typeof te.result === 'string' ? te.result : JSON.stringify(te.result ?? '')
        const truncated = output.slice(0, 50_000)
        const existingTool = toolCallsMap.get(te.toolCallId)

        toolCallsMap.set(te.toolCallId, {
          id: te.toolCallId,
          name: existingTool?.name || te.toolName,
          input: existingTool?.input || '{}',
          output: truncated,
          status: te.isError ? 'error' : 'done',
        })

        sendChunk('tool_result', output.slice(0, 200), {
          toolName: te.toolName,
          toolId: te.toolCallId,
          toolOutput: truncated,
          toolInput: existingTool?.input || '{}',
          ...convExtra,
        })
      }
      // agent_start, agent_end, turn_start, turn_end, message_start, message_end → no-op
    })

    // Extension commands: session.prompt() detects them via text.startsWith("/")
    // so slash commands must be passed directly, not wrapped in <system_context>
    const lastContent = messages[messages.length - 1]?.content?.trim() || ''
    const isSlashCommand = /^\/[\w-]+/.test(lastContent)

    let promptText: string
    if (isSlashCommand) {
      // Pass command directly so SDK can route to extension handler
      promptText = lastContent
    } else {
      const historyPrompt = buildPromptWithHistory(messages)
      promptText = systemPrompt
        ? `<system_context>\n${systemPrompt}\n</system_context>\n\n${historyPrompt}`
        : historyPrompt
    }

    try {
      await session.prompt(promptText)
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
        aborted = true
      } else {
        throw err
      }
    } finally {
      unsubscribe()
      abortController.signal.removeEventListener('abort', onAbort)
      session.dispose()
      uiContext.dispose()
      unregisterPiUIContext(convKey)
    }

    sendChunk('done', undefined, {
      ...convExtra,
      ...(aborted ? { stopReason: 'aborted' } : { stopReason: 'end_turn' }),
    })
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))) {
      aborted = true
      sendChunk('done', undefined, { ...convExtra, stopReason: 'aborted' })
    } else {
      const errorMsg = err instanceof Error ? err.message : 'Unknown PI-SDK streaming error'
      console.error('[streamingPI] Error:', err)
      sendChunk('error', errorMsg, convExtra)
    }
  } finally {
    // Close all MCP clients regardless of how the stream ended
    await Promise.allSettled(mcpHandles.map((h) => h.close()))
    // Only delete if this is still our controller
    if (abortControllers.get(convKey) === abortController) {
      abortControllers.delete(convKey)
    }
    denyPendingForConversation(convKey)
  }

  return { content: fullContent, toolCalls: Array.from(toolCallsMap.values()), aborted, sessionId: null, stopReason: aborted ? 'aborted' : 'end_turn' }
}
