import { TaskFormModal } from '../../scheduler/TaskFormModal'
import { ContextMenu, ContextMenuItem } from '../../shared/ContextMenu'
import type { Message, CreateScheduledTask } from '../../../../shared/types'

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
        <div
          className="absolute -top-3 right-2 flex rounded shadow-md gap-1 px-1 py-0.5 mobile:gap-2 mobile:px-1.5 mobile:py-1 mobile:flex-wrap"
          style={{ backgroundColor: 'var(--color-deep)' }}
        >
          <button
            onClick={onCopy}
            className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
            style={{ color: 'var(--color-text-muted)' }}
            title="Copy"
          >
            Copy
          </button>
          {showTtsButton && (
            <button
              onClick={() => isSpeakingThis ? onStopTts() : onPlayTts()}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: isSpeakingThis ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              title={isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
            >
              {isSpeakingThis ? 'Stop' : 'Play'}
            </button>
          )}
          {isUser && onStartEdit && (
            <button
              onClick={onStartEdit}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: 'var(--color-text-muted)' }}
              title="Edit"
            >
              Edit
            </button>
          )}
          {isUser && onRetry && (
            <button
              onClick={onRetry}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: 'var(--color-text-muted)' }}
              title="Retry this message"
            >
              Retry
            </button>
          )}
          {isUser && (
            <button
              onClick={onOpenTaskForm}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: 'var(--color-text-muted)' }}
              title="Schedule as recurring task"
            >
              Schedule
            </button>
          )}
          {!isUser && isLast && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm"
              style={{ color: 'var(--color-text-muted)' }}
              title="Regenerate"
            >
              Retry
            </button>
          )}
        </div>
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
        <ContextMenu
          position={contextMenuPos}
          onClose={onCloseContextMenu}
          className="min-w-[140px]"
          aria-label="Message actions"
        >
          <ContextMenuItem onClick={(e) => { onCloseContextMenu(); onCopy(e) }}>
            Copy Message
          </ContextMenuItem>
          {selectedText && (
            <ContextMenuItem onClick={(e) => { onCloseContextMenu(); onCopySelection(selectedText, e) }}>
              Copy Selection
            </ContextMenuItem>
          )}
          {showTtsButton && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); isSpeakingThis ? onStopTts() : onPlayTts() }}>
              {isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
            </ContextMenuItem>
          )}
          {isUser && onStartEdit && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); onStartEdit() }}>
              Edit
            </ContextMenuItem>
          )}
          {isUser && onRetry && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); onRetry() }}>
              Retry
            </ContextMenuItem>
          )}
          {isUser && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); onOpenTaskForm() }}>
              Schedule
            </ContextMenuItem>
          )}
          {!isUser && isLast && onRegenerate && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); onRegenerate() }}>
              Retry
            </ContextMenuItem>
          )}
          {onFork && (
            <ContextMenuItem onClick={() => { onCloseContextMenu(); onFork(message.id) }}>
              Fork from here
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}

      {copiedPos && (
        <div
          className="fixed z-50 px-2 py-1 rounded shadow-lg text-[0.6875rem] font-medium pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{
            left: copiedPos.x,
            top: copiedPos.y - 8,
            backgroundColor: 'var(--color-accent)',
            color: 'var(--color-contrast)',
          }}
        >
          Copied!
        </div>
      )}
    </>
  )
}
