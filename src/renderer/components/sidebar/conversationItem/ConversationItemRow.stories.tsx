/**
 * Visual snapshot stories for the sidebar conversation row.
 *
 * ConversationItem is store-connected, so we compose ItemPreview directly
 * inside a row wrapper that replicates the card's look-and-feel.  This lets
 * us cover the four visual states (default, active, selected, colored)
 * without any store wiring.
 */
import type { Meta, StoryObj } from '@storybook/react'
import { ItemPreview } from './ItemPreview'

const noop = () => {}

// ---------------------------------------------------------------------------
// Shared row wrapper — mirrors the div inside ConversationItem
// ---------------------------------------------------------------------------

interface RowProps {
  title: string
  timeAgo: string
  hasScheduledTask?: boolean
  isActive?: boolean
  isSelected?: boolean
  effectiveColor?: string | null
  depth?: number
}

function ConversationRow({
  title,
  timeAgo,
  hasScheduledTask = false,
  isActive = false,
  isSelected = false,
  effectiveColor = null,
  depth = 0,
}: RowProps) {
  const hasOwnColor = !!effectiveColor
  const textColor = hasOwnColor ? '#1a1a1a' : undefined
  const mutedColor = hasOwnColor ? '#1a1a1aaa' : undefined

  const backgroundColor = isActive
    ? effectiveColor
      ? `color-mix(in srgb, ${effectiveColor} 12%, var(--color-deep))`
      : 'var(--color-deep)'
    : isSelected
      ? 'var(--color-bg)'
      : effectiveColor
        ? `color-mix(in srgb, ${effectiveColor} 8%, transparent)`
        : 'transparent'

  const borderLeft = isActive
    ? '2px solid var(--color-primary)'
    : isSelected
      ? '2px solid var(--color-text-muted)'
      : '2px solid transparent'

  return (
    <div
      style={{
        paddingLeft: `${depth * 16 + 12}px`,
        paddingRight: '12px',
        paddingTop: 8,
        paddingBottom: 8,
        backgroundColor,
        borderLeft,
        borderRadius: 4,
        margin: '0 4px',
        cursor: 'pointer',
      }}
    >
      <ItemPreview
        title={title}
        timeAgo={timeAgo}
        hasScheduledTask={hasScheduledTask}
        textColor={textColor}
        mutedColor={mutedColor}
        onThreeDotClick={noop}
      />
    </div>
  )
}

const meta: Meta<typeof ConversationRow> = {
  title: 'Sidebar/ConversationItem/Row',
  component: ConversationRow,
  parameters: { layout: 'padded' },
  args: {
    title: 'Refactor the streaming pipeline',
    timeAgo: '12m ago',
    hasScheduledTask: false,
    isActive: false,
    isSelected: false,
    effectiveColor: null,
    depth: 0,
  },
}

export default meta
type Story = StoryObj<typeof ConversationRow>

/** Plain idle row — no selection, no color, no scheduled badge. */
export const Default: Story = {}

/** Active (selected conversation in the main view). */
export const Active: Story = {
  args: { isActive: true },
}

/** Part of a multi-selection but not the active conversation. */
export const MultiSelected: Story = {
  args: { isSelected: true },
}

/** Conversation with its own background color — text uses contrast-computed color. */
export const WithColor: Story = {
  args: { effectiveColor: '#eab308', hasScheduledTask: true },
}
