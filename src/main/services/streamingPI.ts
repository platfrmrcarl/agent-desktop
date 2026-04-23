import { sendChunk, buildPromptWithHistory, abortControllers } from './streaming'
import { sendChunk as coreSendChunk, pendingRequests } from '../../core/services/streaming'
import { gatePiTools } from './piPermissionGate'
import { createCanUseTool } from '../../core/services/canUseTool'
import { createMcpClient, McpConnectError, type McpClientHandle } from './mcpClient'
import { mcpServerToPiTools } from './mcpToPiTools'
import { loadPISdk } from './piSdk'
import { PiUIContext } from './piUIContext'
import { registerPiUIContext, unregisterPiUIContext } from './piExtensions'
import { getMainWindow } from '../index'
import { getSchedulerMcpConfig, socketPath as schedSocketPath, authToken as schedAuthToken } from './schedulerBridge'
import { existsSync } from 'node:fs'
import { getConversationPiSessionFile, setConversationPiSessionFile } from './messages'
import { getDatabase } from '../../core/db/database'
import { Type } from '@sinclair/typebox'
import type { Static, TSchema } from '@sinclair/typebox'
import type { AISettings } from './streaming'
import type { ToolCall } from '../../shared/types'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import { createBridge, type ExtensionRuntimeContext } from '../../core/services/piExtensionBridge'
import parityFactory from '../../extensions/agent-desktop-parity'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'

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

export async function streamMessagePI(
  messages: MessageParam[],
  systemPrompt: string | undefined,
  aiSettings: AISettings | undefined,
  conversationId: number | undefined,
): Promise<{ content: string; toolCalls: ToolCall[]; aborted: boolean; sessionId: string | null }> {
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
    const extensionBridge = createBridge(conversationId ?? -1, { chunkSender: coreSendChunk })
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

    // Build custom tools array (scheduler tool for PI backend)
    const customTools: ToolDefinition[] = []
    const schedulerConfig = getSchedulerMcpConfig(convKey)
    if (schedulerConfig) {
      // Only add scheduler if socket bridge is available
      if (schedSocketPath && schedAuthToken) {
        customTools.push(createSchedulerTool())
      }
    }

    // --- MCP native integration ---
    const mcpServers = aiSettings?.mcpServers ?? {}
    if (Object.keys(mcpServers).length > 0) {
      const spawnResults = await Promise.allSettled(
        Object.entries(mcpServers)
          .filter(([name]) => !name.includes('__'))
          .map(async ([name, config]) => ({ name, handle: await createMcpClient(name, config) }))
      )
      const mcpTools: import('@mariozechner/pi-coding-agent').ToolDefinition[] = []
      for (const r of spawnResults) {
        if (r.status === 'fulfilled') {
          mcpHandles.push(r.value.handle)
          mcpTools.push(...mcpServerToPiTools(r.value.handle))
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

      // Gate MCP tools with the approval flow (mirrors Claude SDK canUseTool).
      // Scheduler is NOT gated — it is a trusted internal tool added before this block.
      const bypass = aiSettings?.permissionMode === 'bypassPermissions'
      let pendingApprovalCount = 0
      const canUseTool = createCanUseTool({
        aiSettings: {
          requirePlanApproval: aiSettings?.requirePlanApproval,
          disabledSkills: aiSettings?.disabledSkills,
        },
        permissionMode: aiSettings?.permissionMode ?? 'bypassPermissions',
        chunkConversationId: conversationId ?? null,
        pendingRequestsKey: convKey,
        pendingRequests,
        sendChunk: coreSendChunk,
        onApprovalStart: () => { pendingApprovalCount++ },
        onApprovalEnd: () => { pendingApprovalCount-- },
      })
      const gatedMcpTools = gatePiTools(mcpTools, { canUseTool, bypass })
      customTools.push(...gatedMcpTools)
    }
    // --- end MCP ---

    const { sessionManager, persistAfterCreate } = await resolveSessionManager(
      pi,
      conversationId,
      aiSettings?.cwd || process.cwd(),
    )

    const { session } = await pi.createAgentSession({
      cwd: aiSettings?.cwd || process.cwd(),
      sessionManager,
      thinkingLevel,
      tools: pi.codingTools,
      customTools,
      resourceLoader,
    })
    persistAfterCreate()

    // Create UI context and bind to session for extension UI support
    const uiContext = new PiUIContext(
      getMainWindow() || { webContents: { send: () => {} }, isDestroyed: () => true },
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
  }

  return { content: fullContent, toolCalls: Array.from(toolCallsMap.values()), aborted, sessionId: null, stopReason: aborted ? 'aborted' : 'end_turn' }
}
