import { randomUUID } from 'node:crypto'
import type { AISettings } from './streaming'
import { getConversationOverridesWriter } from './streaming'
import type { ToolApprovalResponse } from '../types'

// `better-sqlite3` is imported only as a TYPE — avoids a runtime dep surface
// in the renderer bundle. Actual DB interactions happen in main-process code.
type SqliteDatabase = {
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => unknown }
  transaction: <T>(fn: () => T) => () => T
}

export interface UsageRecord {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  costUsd?: number
}

export interface ExtensionRuntimeContext {
  /** Contract version. Bump on breaking changes to the bridge surface. */
  version: 1
  conversationId: number
  aiSettings: AISettings
  /** Read-only handle — v1 modules do not query DB directly, but the option is reserved. */
  db: SqliteDatabase | null
  bridge: PiExtensionBridge
  /**
   * Session-scoped key/value store. Persists across all `streamMessagePI`
   * calls for a given conversationId until the conversation is cleared.
   * Used e.g. by permissionModes for the dontAsk approval cache so a
   * user who approved `write` on a path isn't re-asked on the next
   * user message of the same conversation.
   */
  sessionStore: Map<string, unknown>
}

export interface PiExtensionBridge {
  /** Emit a system message chunk to the UI stream. */
  emitSystemMessage(content: string, meta?: { hookName?: string; hookEvent?: string }): void

  /** Emit a task-notification-style chunk. */
  emitTaskNotification(summary: string, meta?: { taskId?: string; status?: string; outputFile?: string }): void

  /** Emit an MCP status chunk (parity with Claude init flow). */
  emitMcpStatus(servers: Array<{ name: string; status: string; error?: string }>): void

  /** Record turn usage (extensions read `AssistantMessage.usage` from PI events and call this). */
  recordTokenUsage(usage: UsageRecord): void

  /** Read accumulated usage for budget-cap decisions. */
  getAccumulatedUsage(): { totalTokens: number; totalCostUsd: number }

  /**
   * Persist a conversation-level aiSettings override. Writes to the
   * `ai_overrides` JSON column on the conversation row, merging with
   * existing entries. Cascade resolution on the next turn picks up
   * the new value. Also triggers a `conversationUpdated` broadcast so
   * the renderer's store refreshes the status bar.
   */
  updateConversationSetting(key: string, value: string): void

  /**
   * Blocks the caller until the user approves or rejects the plan.
   * Emits a `tool_approval` stream chunk with `toolName: 'ExitPlanMode'`
   * and `toolInput.plan` set to the provided markdown. The renderer's
   * existing `ToolApprovalBlock` component already special-cases this
   * tool name to render the plan as markdown and offer Approve / Reject
   * buttons (with an optional rejection-feedback textarea).
   *
   * Resolves with `{ approved: true }` on allow, or
   * `{ approved: false, rejectReason }` on deny.
   */
  requestPlanApproval(plan: string): Promise<{ approved: boolean; rejectReason?: string }>
}

export interface BridgeDeps {
  /** Injected at construction; same signature as `core/streaming.ts#sendChunk`. */
  chunkSender: (type: string, content?: string, extra?: Record<string, unknown>) => void
  /**
   * Registers a pending approval/ask-user entry keyed by requestId.
   * When the renderer responds via `respondToApproval`, the resolver
   * is invoked with the user's response. Optional — bridges used in
   * non-streaming contexts (tests) can omit this.
   */
  registerPending?: (requestId: string, resolve: (value: unknown) => void, conversationId: number) => void
}

export function createBridge(conversationId: number, deps: BridgeDeps): PiExtensionBridge {
  const accumulated = { totalTokens: 0, totalCostUsd: 0 }

  return {
    emitSystemMessage(content, meta) {
      const extra: Record<string, unknown> = { conversationId }
      if (meta?.hookName) extra.hookName = meta.hookName
      if (meta?.hookEvent) extra.hookEvent = meta.hookEvent
      deps.chunkSender('system_message', content, extra)
    },

    emitTaskNotification(summary, meta) {
      const extra: Record<string, unknown> = { conversationId }
      if (meta?.taskId) extra.taskId = meta.taskId
      if (meta?.status) extra.status = meta.status
      if (meta?.outputFile) extra.outputFile = meta.outputFile
      deps.chunkSender('task_notification', summary, extra)
    },

    emitMcpStatus(servers) {
      deps.chunkSender('mcp_status', undefined, {
        conversationId,
        mcpServers: JSON.stringify(servers),
      })
    },

    recordTokenUsage(usage) {
      accumulated.totalTokens +=
        (usage.input ?? 0) +
        (usage.output ?? 0) +
        (usage.cacheRead ?? 0) +
        (usage.cacheWrite ?? 0)
      accumulated.totalCostUsd += usage.costUsd ?? 0
    },

    getAccumulatedUsage() {
      return { ...accumulated }
    },

    updateConversationSetting(key, value) {
      const writer = getConversationOverridesWriter()
      if (!writer) {
        console.warn('[piExtensionBridge] updateConversationSetting called before writer injection; skipping')
        return
      }
      writer(conversationId, { [key]: value })
    },

    requestPlanApproval(plan) {
      if (!deps.registerPending) {
        // No registerPending injection — cannot wire the renderer response.
        // Fail-safe: return rejected so the caller treats it as "no approval".
        return Promise.resolve({ approved: false, rejectReason: 'Approval infrastructure unavailable' })
      }
      const requestId = randomUUID()
      return new Promise<{ approved: boolean; rejectReason?: string }>((resolve) => {
        deps.registerPending!(requestId, (response) => {
          const resp = response as ToolApprovalResponse
          if (resp.behavior === 'allow') {
            resolve({ approved: true })
          } else {
            resolve({ approved: false, rejectReason: resp.message })
          }
        }, conversationId)
        deps.chunkSender('tool_approval', undefined, {
          conversationId,
          requestId,
          toolName: 'ExitPlanMode',
          toolInput: JSON.stringify({ plan }),
        })
      })
    },
  }
}
