const BTN_CLASS =
  'rounded hover:opacity-80 transition-opacity px-2 py-0.5 text-[0.625rem] mobile:px-4 mobile:py-3 mobile:text-sm'

export interface ActionBarProps {
  isUser: boolean
  isLast: boolean
  showTtsButton: boolean
  isSpeakingThis: boolean
  // Callbacks
  onCopy: () => void
  onPlayTts: () => void
  onStopTts: () => void
  onStartEdit?: () => void
  onRetry?: () => void
  onOpenTaskForm: () => void
  onRegenerate?: () => void
}

export function ActionBar({
  isUser,
  isLast,
  showTtsButton,
  isSpeakingThis,
  onCopy,
  onPlayTts,
  onStopTts,
  onStartEdit,
  onRetry,
  onOpenTaskForm,
  onRegenerate,
}: ActionBarProps) {
  return (
    <div
      className="absolute -top-3 right-2 flex rounded shadow-md gap-1 px-1 py-0.5 mobile:gap-2 mobile:px-1.5 mobile:py-1 mobile:flex-wrap"
      style={{ backgroundColor: 'var(--color-deep)' }}
    >
      <button
        onClick={onCopy}
        className={BTN_CLASS}
        style={{ color: 'var(--color-text-muted)' }}
        title="Copy"
      >
        Copy
      </button>

      {showTtsButton && (
        <button
          onClick={() => (isSpeakingThis ? onStopTts() : onPlayTts())}
          className={BTN_CLASS}
          style={{ color: isSpeakingThis ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          title={isSpeakingThis ? 'Stop TTS' : 'Play TTS'}
        >
          {isSpeakingThis ? 'Stop' : 'Play'}
        </button>
      )}

      {isUser && onStartEdit && (
        <button
          onClick={onStartEdit}
          className={BTN_CLASS}
          style={{ color: 'var(--color-text-muted)' }}
          title="Edit"
        >
          Edit
        </button>
      )}

      {isUser && onRetry && (
        <button
          onClick={onRetry}
          className={BTN_CLASS}
          style={{ color: 'var(--color-text-muted)' }}
          title="Retry this message"
        >
          Retry
        </button>
      )}

      {isUser && (
        <button
          onClick={onOpenTaskForm}
          className={BTN_CLASS}
          style={{ color: 'var(--color-text-muted)' }}
          title="Schedule as recurring task"
        >
          Schedule
        </button>
      )}

      {!isUser && isLast && onRegenerate && (
        <button
          onClick={onRegenerate}
          className={BTN_CLASS}
          style={{ color: 'var(--color-text-muted)' }}
          title="Regenerate"
        >
          Retry
        </button>
      )}
    </div>
  )
}
