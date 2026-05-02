// Internal DTOs shared between messages.ts and its private helpers.
// These types are NOT re-exported from any public barrel — they live
// inside the messages handler module.

import type { SqlJsAdapter } from '../../db/sqljs-adapter'
import type { AISettings } from '../../services/streaming'
import type { MessagesHandlerOptions } from '../messages'

export interface MessageStreamContext {
  db: SqlJsAdapter
  conversationId: number
  generation: number
  sdkSessionId: string | null
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  aiSettings: AISettings
  systemPrompt: string
  hookSystemContents: string[]
  options: MessagesHandlerOptions
}

export interface RetrySettings {
  enabled: boolean
  maxAttempts: number
  initialDelayMs: number
}
