import type { Meta, StoryObj } from '@storybook/react'
import { ItemPreview } from './ItemPreview'

const noop = () => {}

const meta: Meta<typeof ItemPreview> = {
  title: 'Sidebar/ConversationItem/ItemPreview',
  component: ItemPreview,
  args: {
    title: 'Refactor the streaming pipeline',
    timeAgo: '5m ago',
    hasScheduledTask: false,
    textColor: undefined,
    mutedColor: undefined,
    onThreeDotClick: noop,
  },
}

export default meta
type Story = StoryObj<typeof ItemPreview>

/** Standard conversation row with no special styling. */
export const Default: Story = {}

/** Shows the clock badge that appears when a scheduled task is attached. */
export const WithScheduledTask: Story = {
  args: { hasScheduledTask: true },
}

/** Title and timestamp forced to explicit colors — used when the card has a background color. */
export const WithExplicitColors: Story = {
  args: {
    textColor: '#1a1a1a',
    mutedColor: '#1a1a1aaa',
  },
  decorators: [
    (Story) => (
      <div style={{ backgroundColor: '#eab308', padding: 8, borderRadius: 4 }}>
        <Story />
      </div>
    ),
  ],
}
