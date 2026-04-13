import type { ScheduledTask, ToolCall } from '../types'
import type { AISettings } from './streaming'
import type { SchedulerService } from './scheduler'

// ─── TaskRunContext (injected by Electron or headless) ─────

export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
  aborted: boolean
  sessionId: string | null
  error?: string
}

export interface TaskRunContext {
  buildHistory(conversationId: number): Array<{ role: 'user' | 'assistant'; content: string }>
  getAISettings(conversationId: number): AISettings
  getSystemPrompt(conversationId: number, cwd: string): Promise<string>
  streamMessage(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    systemPrompt: string,
    aiSettings: AISettings,
    conversationId: number
  ): Promise<StreamResult>
  saveMessage(conversationId: number, role: string, content: string, attachments?: unknown[], toolCalls?: ToolCall[]): void
  notify(title: string, body: string): Promise<void>
  /** Called when a task or conversation state changes — broadcast to renderer / logs */
  onTaskUpdate(task: ScheduledTask): void
  onConversationsRefresh(): void
}

// ─── executeTask ───────────────────────────────────────────

/**
 * Execute a scheduled task. Pure orchestration — all I/O goes through ctx.
 * Manages: mark running → verify conversation → build context → stream → save → mark success/error → notify.
 */
export async function executeTask(
  scheduler: SchedulerService,
  ctx: TaskRunContext,
  task: ScheduledTask
): Promise<void> {
  scheduler.markRunning(task.id)
  ctx.onTaskUpdate({ ...task, last_status: 'running' })

  try {
    // Verify conversation still exists — recreate if deleted
    const originalConvId = task.conversation_id
    task = scheduler.ensureConversation(task)
    if (task.conversation_id !== originalConvId) {
      ctx.onConversationsRefresh()
    }

    // Save user message (the scheduled prompt)
    ctx.saveMessage(task.conversation_id, 'user', task.prompt)

    // Build context — same flow as messages:send
    const history = ctx.buildHistory(task.conversation_id)
    const aiSettings = ctx.getAISettings(task.conversation_id)

    // Force bypass for unattended execution
    aiSettings.permissionMode = 'bypassPermissions'

    // Prevent recursive task creation: remove scheduler MCP from unattended execution
    delete aiSettings.mcpServers?.['agent_scheduler']

    const systemPrompt = await ctx.getSystemPrompt(task.conversation_id, aiSettings.cwd!)

    const { content, toolCalls, error } = await ctx.streamMessage(
      history, systemPrompt, aiSettings, task.conversation_id
    )

    if (error) throw new Error(error)

    if (content) {
      // Check conversation still exists (may have been deleted during streaming)
      if (scheduler.conversationExists(task.conversation_id)) {
        ctx.saveMessage(task.conversation_id, 'assistant', content, [], toolCalls)
      }
    }

    // Mark success + compute next run
    scheduler.markSuccess(task.id, task)

    const updated = scheduler.get(task.id)
    if (updated) ctx.onTaskUpdate(updated)

    // Notifications
    if (task.notify_desktop) {
      await ctx.notify(task.name, (content || 'Task completed').slice(0, 200)).catch(() => {})
    }

    // Refresh conversation list
    ctx.onConversationsRefresh()
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    scheduler.markError(task.id, task, errorMsg)

    const updated = scheduler.get(task.id)
    if (updated) ctx.onTaskUpdate(updated)

    console.error(`[scheduler] Task "${task.name}" (id=${task.id}) failed:`, errorMsg)
  }
}
