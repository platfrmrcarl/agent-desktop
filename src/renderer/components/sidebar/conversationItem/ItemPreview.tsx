import { memo } from 'react'

interface Props {
  title: string
  timeAgo: string
  hasScheduledTask: boolean
  textColor: string | undefined
  mutedColor: string | undefined
  onThreeDotClick: (e: React.MouseEvent) => void
}

/**
 * Displays the conversation title, relative timestamp, optional scheduled-task
 * badge, and the three-dot mobile action button.
 * Pure display — no store access, no state.
 */
export const ItemPreview = memo(function ItemPreview({
  title,
  timeAgo,
  hasScheduledTask,
  textColor,
  mutedColor,
  onThreeDotClick,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <div
          className="text-sm truncate font-medium flex-1"
          style={{ color: textColor ?? 'var(--color-text)' }}
        >
          {title}
        </div>
        {hasScheduledTask && (
          <svg
            className="w-3 h-3 flex-shrink-0"
            style={{ color: 'var(--color-primary)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-label="Has scheduled task"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
        <button
          onClick={onThreeDotClick}
          className="hidden mobile:block p-2.5 rounded flex-shrink-0 hover:bg-[var(--color-surface)]"
          style={{ color: mutedColor ?? 'var(--color-text-muted)' }}
          aria-label="Conversation actions"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="4" r="1.5" />
            <circle cx="10" cy="10" r="1.5" />
            <circle cx="10" cy="16" r="1.5" />
          </svg>
        </button>
      </div>
      <div
        className="text-xs mt-0.5 truncate"
        style={{ color: mutedColor ?? 'var(--color-text-muted)' }}
      >
        {timeAgo}
      </div>
    </>
  )
})
