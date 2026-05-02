import { useState } from 'react'
import type { StreamPart, Conversation, AIOverrides } from '../../../shared/types'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useChatStore } from '../../stores/chatStore'
import { useConversationsStore } from '../../stores/conversationsStore'
import { createLogger } from '../../../core/utils/logger'

const log = createLogger('PlanApprovalBlock')

type PlanApprovalPart = Extract<StreamPart, { type: 'plan_approval_request' }>

interface PlanApprovalBlockProps {
  approval: PlanApprovalPart
}

function parseOverrides(raw: string | null | undefined): AIOverrides {
  if (!raw) return {}
  try { return JSON.parse(raw) as AIOverrides } catch { return {} }
}

/**
 * PI-only counterpart to ToolApprovalBlock. Emitted by the agent-desktop-parity
 * extension's `exit_plan_mode` tool.
 *
 * Core difference from the Claude-path ToolApprovalBlock:
 *   - NOT a blocking respondToApproval — the agent's turn already ended.
 *   - Clicking Approve sends a NEW user message ("Plan approved — proceed.")
 *     AND flips ai_permissionMode to 'bypassPermissions' in conversation
 *     overrides. The cascade delivers the new mode on the next turn, so
 *     mutating tools appear naturally in the default codingTools set.
 *   - Clicking Reject sends a user message with the typed feedback. The
 *     setting stays on 'plan' so the agent iterates within plan mode.
 */
export function PlanApprovalBlock({ approval }: PlanApprovalBlockProps) {
  const [responded, setResponded] = useState<'approve' | 'reject' | null>(null)
  const [feedback, setFeedback] = useState('')
  const sendMessage = useChatStore((s) => s.sendMessage)
  const clearPendingPlanApproval = useChatStore((s) => s.clearPendingPlanApproval)
  const conversations = useConversationsStore((s) => s.conversations)
  const updateConversation = useConversationsStore((s) => s.updateConversation)

  const handleApprove = async (): Promise<void> => {
    if (responded) return
    setResponded('approve')
    clearPendingPlanApproval(approval.conversationId)
    // Merge ai_permissionMode='bypassPermissions' into the conversation's
    // ai_overrides so the cascade delivers it on the next turn.
    const conv = conversations.find((c: Conversation) => c.id === approval.conversationId)
    const current = parseOverrides(conv?.ai_overrides)
    const next: AIOverrides = { ...current, ai_permissionMode: 'bypassPermissions' }
    try {
      await updateConversation(approval.conversationId, { ai_overrides: JSON.stringify(next) } as Partial<Conversation>)
    } catch (err) {
      log.error('failed to flip permissionMode', err)
    }
    await sendMessage(approval.conversationId, 'Plan approved — proceed with execution.')
  }

  const handleReject = async (): Promise<void> => {
    if (responded) return
    setResponded('reject')
    clearPendingPlanApproval(approval.conversationId)
    const reason = feedback.trim() || '(no specific feedback provided)'
    await sendMessage(approval.conversationId, `Plan rejected. Feedback: ${reason}`)
  }

  return (
    <div
      className="my-2 rounded-md px-3 py-2 text-xs font-mono status-block-warning"
      role="alert"
      aria-label="Plan approval required"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-warning">
          {'\u{1F6E1}️'} Plan ready — review before leaving plan mode
        </span>
      </div>

      <div className="mt-2 rounded bg-base/40 px-3 py-2 text-sm font-sans max-h-96 overflow-y-auto">
        <MarkdownRenderer content={approval.plan} />
      </div>

      {responded ? (
        <div
          className={`mt-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
            responded === 'approve' ? 'chip-success' : 'chip-error'
          }`}
        >
          {responded === 'approve' ? '✓ Approved' : '✗ Rejected'}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <label
              htmlFor={`plan-reject-reason-${approval.conversationId}`}
              className="block text-[0.6875rem] mb-1 font-sans"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Feedback (optional — sent to the agent if you reject the plan):
            </label>
            <textarea
              id={`plan-reject-reason-${approval.conversationId}`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="e.g. Skip step 2, focus on tests first…"
              className="w-full rounded-lg px-3 py-2 text-sm font-sans outline-none resize-y leading-6"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid color-mix(in srgb, var(--color-text-muted) 25%, transparent)',
              }}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleApprove}
              className="rounded font-medium transition-colors hover:opacity-90 bg-success text-contrast px-3 py-1 text-xs mobile:px-5 mobile:py-3 mobile:text-sm"
              aria-label="Approve plan and proceed"
            >
              Approve & proceed
            </button>
            <button
              onClick={handleReject}
              className="rounded font-medium transition-colors hover:opacity-90 bg-error text-contrast px-3 py-1 text-xs mobile:px-5 mobile:py-3 mobile:text-sm"
              aria-label="Reject plan and request revisions"
            >
              Reject & revise
            </button>
          </div>
        </>
      )}
    </div>
  )
}
