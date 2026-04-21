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

export function createBridge(_conversationId: number, _deps: BridgeDeps): PiExtensionBridge {
  throw new Error('createBridge not implemented yet — see Task 5')
}
