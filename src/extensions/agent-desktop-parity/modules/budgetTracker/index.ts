import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'

const ACCUM_KEY = 'budgetTracker.accumulatedCostUsd'

/**
 * Phase 5 — budget cap enforcement.
 *
 * Accumulates `AssistantMessage.usage.cost.total` (PI-normalized across
 * providers) into `ctx.sessionStore` so the cap covers the entire
 * conversation, not just a single user message. When the accumulated
 * cost reaches `aiSettings.maxBudgetUsd`, the next `tool_call` is
 * blocked with a budget-reached system_message.
 *
 * No-op when `maxBudgetUsd` is unset or 0 (unlimited).
 */
export function initBudgetTracker(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const cap = ctx.aiSettings.maxBudgetUsd
  if (!cap || cap <= 0) return

  const getAccumulated = (): number => (ctx.sessionStore.get(ACCUM_KEY) as number) ?? 0
  const addCost = (costUsd: number): void => {
    ctx.sessionStore.set(ACCUM_KEY, getAccumulated() + costUsd)
  }

  type MessageEndEvent = {
    message: {
      role: string
      usage?: {
        input?: number
        output?: number
        cacheRead?: number
        cacheWrite?: number
        cost?: { total?: number }
      }
    }
  }
  type ToolCallEvent = { toolName: string; input: Record<string, unknown> }
  type Decision = { block: true; reason: string } | undefined

  const on = <E, R>(event: string, handler: (event: E) => R | Promise<R>): void => {
    ;(pi as unknown as { on: (e: string, h: (e: E) => R | Promise<R>) => void }).on(event, handler)
  }

  on<MessageEndEvent, void>('message_end', (event) => {
    const msg = event.message
    if (msg.role !== 'assistant' || !msg.usage) return
    const cost = msg.usage.cost?.total ?? 0
    if (cost <= 0) return
    addCost(cost)
    ctx.bridge.recordTokenUsage({
      input: msg.usage.input ?? 0,
      output: msg.usage.output ?? 0,
      cacheRead: msg.usage.cacheRead ?? 0,
      cacheWrite: msg.usage.cacheWrite ?? 0,
      costUsd: cost,
    })
  })

  on<ToolCallEvent, Decision>('tool_call', () => {
    const current = getAccumulated()
    if (current < cap) return undefined
    const reason = `Budget cap $${cap.toFixed(2)} reached ($${current.toFixed(4)} spent this conversation).`
    ctx.bridge.emitSystemMessage(
      `Budget cap $${cap.toFixed(2)} reached ($${current.toFixed(4)} spent). Further tools halted by budget-tracker.`,
      { hookName: 'budget-tracker', hookEvent: 'PreToolUse' },
    )
    return { block: true, reason }
  })
}
