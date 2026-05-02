import type { Meta, StoryObj } from '@storybook/react'
import { ChatAttachmentsPreview } from './ChatAttachments'
import type { Attachment } from '../../../shared/types'

const sampleAttachments: Attachment[] = [
  { name: 'design-mockup.png', path: '/tmp/design-mockup.png', type: 'image/png', size: 481_204 },
  { name: 'transcript.md', path: '/tmp/transcript.md', type: 'text/markdown', size: 8_133 },
  { name: 'budget.xlsx', path: '/tmp/budget.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 28_900 },
]

const meta: Meta<typeof ChatAttachmentsPreview> = {
  title: 'Pages/Chat/Attachments',
  component: ChatAttachmentsPreview,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof ChatAttachmentsPreview>

/**
 * Empty state: when nothing is attached the preview returns null. We render
 * a wrapper note so the story still has visible content.
 */
export const Empty: Story = {
  render: () => (
    <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
      No attachments — the preview component returns null. Add files via the
      drop zone or the upload button to see the preview.
    </div>
  ),
}

/**
 * Single attachment — the typical case for a quick paste-from-clipboard or
 * single-file drop.
 */
export const SingleAttachment: Story = {
  args: {
    attachments: [sampleAttachments[0]],
    onRemove: () => {},
  },
}

/**
 * Several attachments lined up — exercises the horizontal layout and
 * remove-button affordance on each entry.
 */
export const MultipleAttachments: Story = {
  args: {
    attachments: sampleAttachments,
    onRemove: () => {},
  },
}
