import type { Meta, StoryObj } from '@storybook/react'
import { CopiedToast } from './CopiedToast'

const meta: Meta<typeof CopiedToast> = {
  title: 'Chat/Bubble/CopiedToast',
  component: CopiedToast,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof CopiedToast>

export const Default: Story = {
  args: {
    position: { x: 200, y: 200 },
  },
}
