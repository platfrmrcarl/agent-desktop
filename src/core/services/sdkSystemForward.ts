/**
 * Pure forwarding primitives for the three SDK `system` subtypes that map to
 * user-visible chunks: `init` (mcp servers status), `hook_response` (hook
 * system messages), and `task_notification` (background task results).
 *
 * Why these exist:
 *   `streaming.ts` (one-shot) and `sessionManager.ts` (long-lived) both need
 *   to forward the exact same chunk shapes for these three subtypes. Keeping
 *   the chunk-construction code duplicated meant Anthropic SDK shape changes
 *   would require two synchronised edits — true knowledge duplication.
 *
 * What stays in each caller:
 *   The lifecycle handling around the forward (decrementing pending task
 *   counters, prompting agent aggregation, console-logging task_started /
 *   task_progress) is per-caller and stays inline. The choice of `sender`
 *   (bufferable vs direct) is also per-caller — see ChunkSender doc below.
 */

/**
 * Subset of SDK system-message fields used by the forwarding primitives.
 * `streaming.ts` (`SystemMessage`) and `sessionManager.ts` (`SystemMsg`) have
 * local interfaces that are structurally compatible with this — callers pass
 * their own typed values directly without conversion.
 */
import { createLogger } from '../utils/logger'

const log = createLogger('sdkSystemForward')

export interface SdkSystemMessageForward {
  subtype?: string
  mcp_servers?: Array<{ name: string; status: string; error?: string }>
  hook_name?: string
  hook_event?: string
  output?: string
  stdout?: string
  task_id?: string
  status?: string
  output_file?: string
  summary?: string
}

/**
 * Callback that emits a chunk to the consumer.
 *
 * Each caller chooses the appropriate sender per subtype. `sessionManager.ts`
 * routes `init` and `hook_response` through `sendOrBuffer` (held back while a
 * tool approval is pending) but routes `task_notification` through `sendChunk`
 * directly — a background task notification must reach the user even mid-
 * approval. `streaming.ts` (one-shot has no pending-approval buffer) routes
 * all three through its single `buffer.sendOrBuffer`.
 */
export type ChunkSender = (
  type: string,
  content?: string,
  extra?: Record<string, string | number>,
) => void

/**
 * Forward an SDK init system message as an `mcp_status` chunk and log any
 * MCP server that failed to connect. Caller must verify
 * `sysMsg.subtype === 'init' && sysMsg.mcp_servers` before calling — this
 * primitive does no subtype check (cheaper, callers already branch).
 *
 * `logPrefix` is forwarded as `ctx.source` in the structured log entry
 * so the originating caller remains identifiable in log streams.
 */
export function forwardInitMcpStatus(
  sysMsg: SdkSystemMessageForward,
  sender: ChunkSender,
  convExtra: Record<string, number>,
  logPrefix: string,
): void {
  if (!sysMsg.mcp_servers) return
  sender('mcp_status', undefined, {
    mcpServers: JSON.stringify(sysMsg.mcp_servers),
    ...convExtra,
  })
  for (const s of sysMsg.mcp_servers) {
    if (s.status !== 'connected') {
      log.error('MCP server connection failed', undefined, { source: logPrefix, name: s.name, status: s.status, error: s.error })
    }
  }
}

/**
 * Forward an SDK hook_response system message: parse JSON output, extract
 * `systemMessage`, emit a `system_message` chunk if present. Non-JSON output
 * and missing `systemMessage` field are silent no-ops. Caller must verify
 * `sysMsg.subtype === 'hook_response'` first.
 */
export function forwardHookSystemMessage(
  sysMsg: SdkSystemMessageForward,
  sender: ChunkSender,
  convExtra: Record<string, number>,
): void {
  const raw = sysMsg.output || sysMsg.stdout || ''
  if (!raw) return
  let systemMessage: string | undefined
  try {
    const parsed = JSON.parse(raw) as { systemMessage?: string }
    systemMessage = parsed.systemMessage
  } catch {
    return
  }
  if (!systemMessage) return
  sender('system_message', systemMessage, {
    ...convExtra,
    ...(sysMsg.hook_name ? { hookName: sysMsg.hook_name } : {}),
    ...(sysMsg.hook_event ? { hookEvent: sysMsg.hook_event } : {}),
  })
}

/**
 * Forward an SDK task_notification system message as a `task_notification`
 * chunk. Caller must verify `sysMsg.subtype === 'task_notification'` first.
 *
 * Lifecycle handling (decrementing `pendingTaskCount`, prompting for
 * aggregation when the deferred turn-end is ready to flush) belongs to the
 * caller — this primitive only forwards the chunk.
 */
export function forwardTaskNotification(
  sysMsg: SdkSystemMessageForward,
  sender: ChunkSender,
  convExtra: Record<string, number>,
): void {
  sender('task_notification', sysMsg.summary, {
    ...convExtra,
    ...(sysMsg.task_id ? { taskId: sysMsg.task_id } : {}),
    ...(sysMsg.status ? { taskStatus: sysMsg.status } : {}),
    ...(sysMsg.output_file ? { outputFile: sysMsg.output_file } : {}),
  })
}
