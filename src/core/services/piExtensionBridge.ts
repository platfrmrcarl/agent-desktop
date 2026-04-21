import type { AISettings } from './streaming'

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
}

export interface BridgeDeps {
  /** Injected at construction; same signature as `core/streaming.ts#sendChunk`. */
  chunkSender: (type: string, content?: string, extra?: Record<string, unknown>) => void
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
  }
}
