import { useCallback } from 'react'
import { QueuePanel } from '../../components/chat/QueuePanel'
import { useChatStore } from '../../stores/chatStore'
import { useShallow } from 'zustand/react/shallow'
import type { QueuedMessage } from '../../stores/chatStore'

const EMPTY_QUEUE: QueuedMessage[] = []

interface ChatQueuePanelProps {
  conversationId: number
}

/**
 * Wrapper that owns its own granular Zustand selectors for the per-conversation
 * queue + paused flag, plus all the queue-action callbacks. We deliberately
 * read the chat store here (rather than receiving everything as props) to
 * preserve selector locality — the parent only re-renders for state IT cares
 * about, and the queue panel only re-renders when the queue or paused flag
 * for THIS conversation changes.
 *
 * Action selectors are batched via useShallow so the destructured handlers
 * share a stable reference across renders.
 */
export function ChatQueuePanelContainer({ conversationId }: ChatQueuePanelProps) {
  const messages = useChatStore((s) => s.messageQueues[conversationId] ?? EMPTY_QUEUE)
  const paused = useChatStore((s) => !!s.queuePaused[conversationId])

  const actions = useChatStore(useShallow((s) => ({
    editQueuedMessage: s.editQueuedMessage,
    removeFromQueue: s.removeFromQueue,
    reorderQueue: s.reorderQueue,
    clearQueue: s.clearQueue,
    resumeQueue: s.resumeQueue,
    lockQueueForEdit: s.lockQueueForEdit,
    unlockQueueForEdit: s.unlockQueueForEdit,
  })))

  const onEdit = useCallback(
    (id: string, content: string) => actions.editQueuedMessage(conversationId, id, content),
    [conversationId, actions],
  )
  const onDelete = useCallback(
    (id: string) => actions.removeFromQueue(conversationId, id),
    [conversationId, actions],
  )
  const onReorder = useCallback(
    (from: number, to: number) => actions.reorderQueue(conversationId, from, to),
    [conversationId, actions],
  )
  const onClear = useCallback(() => actions.clearQueue(conversationId), [conversationId, actions])
  const onResume = useCallback(() => actions.resumeQueue(conversationId), [conversationId, actions])
  const onEditStart = useCallback(() => actions.lockQueueForEdit(conversationId), [conversationId, actions])
  const onEditEnd = useCallback(() => actions.unlockQueueForEdit(conversationId), [conversationId, actions])

  return (
    <QueuePanel
      messages={messages}
      paused={paused}
      onEdit={onEdit}
      onDelete={onDelete}
      onReorder={onReorder}
      onClear={onClear}
      onResume={onResume}
      onEditStart={onEditStart}
      onEditEnd={onEditEnd}
    />
  )
}

/**
 * Convenience selector for callers that need to know whether messages are
 * queued (e.g. MessageInput shows a "queue" button instead of "send" when
 * streaming + queue non-empty). Using a granular selector here means the
 * caller only re-renders when this specific boolean flips.
 */
export function useHasQueuedMessages(conversationId: number | null): boolean {
  return useChatStore((s) => {
    if (conversationId == null) return false
    const q = s.messageQueues[conversationId]
    return !!q && q.length > 0
  })
}
