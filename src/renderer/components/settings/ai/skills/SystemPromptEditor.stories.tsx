import type { Meta, StoryObj } from '@storybook/react'
import { SystemPromptEditor, type SystemPromptEditorProps } from './SystemPromptEditor'

const noop = () => {}

const baseArgs: SystemPromptEditorProps = {
  value: '',
  onChange: noop,
}

const meta: Meta<typeof SystemPromptEditor> = {
  title: 'Settings/AI/Skills/SystemPromptEditor',
  component: SystemPromptEditor,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof SystemPromptEditor>

export const Empty: Story = {}

export const WithContent: Story = {
  args: {
    value: 'You are a senior engineer. Always think before answering. Prefer concise, well-reasoned responses with concrete code samples.',
  },
}
