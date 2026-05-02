import type { Meta, StoryObj } from '@storybook/react'
import { QueuePanel } from '../../components/chat/QueuePanel'
import type { QueuedMessage } from '../../stores/chatStore'

/**
 * Stories for the QueuePanel surface. We mount QueuePanel directly with
 * canned props rather than the ChatQueuePanelContainer wrapper because the
 * container's only role is to bind to chatStore — its behaviour is verified
 * by direct selector tests, while these stories exercise the visual states
 * an operator will care about.
 */

const queueOf = (n: number): QueuedMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `q-${i}`,
    content: `Queued message #${i + 1} — \`/think hard\` and respond with a checklist.`,
    createdAt: Date.now() - (n - i) * 1000,
  }))

const meta: Meta<typeof QueuePanel> = {
  title: 'Pages/Chat/QueuePanel',
  component: QueuePanel,
  args: {
    onEdit: () => {},
    onDelete: () => {},
    onReorder: () => {},
    onClear: () => {},
    onResume: () => {},
    onEditStart: () => {},
    onEditEnd: () => {},
  },
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof QueuePanel>

/**
 * No queued messages — panel collapses out of view.
 */
export const Empty: Story = {
  args: { messages: [], paused: false },
}

/**
 * Three queued messages, queue running. Default operator view while a
 * conversation is mid-stream and the user has stacked follow-ups.
 */
export const QueueRunning: Story = {
  args: { messages: queueOf(3), paused: false },
}

/**
 * Five queued messages, queue paused. Resume button should be visible and
 * the rows are reorderable.
 */
export const QueuePaused: Story = {
  args: { messages: queueOf(5), paused: true },
}
