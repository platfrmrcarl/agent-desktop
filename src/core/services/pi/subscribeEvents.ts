// PI-SDK event subscription: maps PI session events to the StreamChunk protocol.
//
// PI SDK uses session.subscribe() with a synchronous event callback. This is
// fundamentally different from the Claude Agent SDK which uses async iterables
// over ChatCompletionStreamEvents. Do NOT attempt to share event-handling logic
// between the two paths — the event shapes, approval buffering, and lifecycle
// hooks are asymmetric.

import { sendChunk } from '../streaming'
import type { ToolCall } from '../../../shared/types'

export interface EventAccumulator {
  fullContent: string
  toolCallsMap: Map<string, ToolCall>
}

export interface SubscribeEventsOptions {
  session: {
    subscribe(listener: (event: unknown) => void): () => void
  }
  accumulator: EventAccumulator
  convExtra: Record<string, string | number>
}

export function subscribeEvents(opts: SubscribeEventsOptions): () => void {
  const { session, accumulator, convExtra } = opts

  return session.subscribe((event) => {
    const ev = event as { type: string }

    if (ev.type === 'message_update') {
      const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
      if (ame?.type === 'text_delta' && ame.delta) {
        accumulator.fullContent += ame.delta
        sendChunk('text', ame.delta, convExtra)
      }
    } else if (ev.type === 'tool_execution_start') {
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

      accumulator.toolCallsMap.set(te.toolCallId, {
        id: te.toolCallId,
        name: te.toolName,
        input: inputJson,
        output: '',
        status: 'done',
      })
    } else if (ev.type === 'tool_execution_end') {
      const te = event as { toolCallId: string; toolName: string; result: unknown; isError: boolean }
      const output = typeof te.result === 'string' ? te.result : JSON.stringify(te.result ?? '')
      const truncated = output.slice(0, 50_000)
      const existingTool = accumulator.toolCallsMap.get(te.toolCallId)

      accumulator.toolCallsMap.set(te.toolCallId, {
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
}
