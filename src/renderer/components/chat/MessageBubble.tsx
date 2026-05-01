import { UserBubble } from './bubble/UserBubble'
import { AssistantBubble } from './bubble/AssistantBubble'
import type { Message } from '../../../shared/types'

export interface MessageBubbleProps {
  message: Message
  isLast: boolean
  effectiveTtsResponseMode?: string
  effectiveAgentName?: string
  effectiveSdkBackend?: string
  onEdit?: (messageId: number, content: string) => void
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
}

export function MessageBubble({
  message,
  isLast,
  effectiveTtsResponseMode,
  effectiveAgentName,
  effectiveSdkBackend,
  onEdit,
  onRegenerate,
  onFork,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <UserBubble
        message={message}
        isLast={isLast}
        effectiveTtsResponseMode={effectiveTtsResponseMode}
        onEdit={onEdit}
        onFork={onFork}
      />
    )
  }
  return (
    <AssistantBubble
      message={message}
      isLast={isLast}
      effectiveTtsResponseMode={effectiveTtsResponseMode}
      effectiveAgentName={effectiveAgentName}
      effectiveSdkBackend={effectiveSdkBackend}
      onRegenerate={onRegenerate}
      onFork={onFork}
    />
  )
}
