import { TaskFormModal } from '../../scheduler/TaskFormModal'
import type { Message, CreateScheduledTask } from '../../../../shared/types'
import { ActionBar } from './actions/ActionBar'
import { BubbleContextMenu } from './actions/BubbleContextMenu'
import { CopiedToast } from './actions/CopiedToast'

export interface BubbleActionsProps {
  message: Message
  isUser: boolean
  isLast: boolean
  showActions: boolean
  isSpeakingThis: boolean
  showTtsButton: boolean
  isEditing: boolean
  // Copy
  onCopy: (e?: React.MouseEvent) => void
  copiedPos: { x: number; y: number } | null
  // TTS
  onPlayTts: () => void
  onStopTts: () => void
  // Edit / retry
  onStartEdit?: () => void
  onRetry?: () => void
  // Regenerate / fork
  onRegenerate?: () => void
  onFork?: (messageId: number) => void
  // Task form
  showTaskForm: boolean
  onOpenTaskForm: () => void
  onCloseTaskForm: () => void
  onSaveTask: (data: CreateScheduledTask) => Promise<void>
  // Context menu
  showContextMenu: boolean
  contextMenuPos: { x: number; y: number }
  selectedText: string
  onCloseContextMenu: () => void
  onCopySelection: (text: string, e: React.MouseEvent) => void
}

export function BubbleActions({
  message,
  isUser,
  isLast,
  showActions,
  isSpeakingThis,
  showTtsButton,
  isEditing,
  onCopy,
  copiedPos,
  onPlayTts,
  onStopTts,
  onStartEdit,
  onRetry,
  onRegenerate,
  onFork,
  showTaskForm,
  onOpenTaskForm,
  onCloseTaskForm,
  onSaveTask,
  showContextMenu,
  contextMenuPos,
  selectedText,
  onCloseContextMenu,
  onCopySelection,
}: BubbleActionsProps) {
  return (
    <>
      {(showActions || isSpeakingThis) && !isEditing && (
        <ActionBar
          isUser={isUser}
          isLast={isLast}
          showTtsButton={showTtsButton}
          isSpeakingThis={isSpeakingThis}
          onCopy={() => onCopy()}
          onPlayTts={onPlayTts}
          onStopTts={onStopTts}
          onStartEdit={onStartEdit}
          onRetry={onRetry}
          onOpenTaskForm={onOpenTaskForm}
          onRegenerate={onRegenerate}
        />
      )}

      {showTaskForm && (
        <TaskFormModal
          initialPrompt={message.content}
          initialConversationId={message.conversation_id}
          onSave={onSaveTask}
          onClose={onCloseTaskForm}
        />
      )}

      {showContextMenu && (
        <BubbleContextMenu
          position={contextMenuPos}
          isUser={isUser}
          isLast={isLast}
          showTtsButton={showTtsButton}
          isSpeakingThis={isSpeakingThis}
          selectedText={selectedText}
          onClose={onCloseContextMenu}
          onCopyMessage={(e) => onCopy(e)}
          onCopySelection={onCopySelection}
          onPlayTts={onPlayTts}
          onStopTts={onStopTts}
          onStartEdit={onStartEdit}
          onRetry={onRetry}
          onOpenTaskForm={onOpenTaskForm}
          onRegenerate={onRegenerate}
          onFork={onFork}
          messageId={message.id}
        />
      )}

      {copiedPos && <CopiedToast position={copiedPos} />}
    </>
  )
}
