import type { Meta, StoryObj } from '@storybook/react'
import { PromptSection, type PromptSectionProps } from './PromptSection'

const noop = () => {}

const baseArgs: PromptSectionProps = {
  name: 'Daily news summary',
  prompt: 'Summarize the top tech news from the past 24 hours.',
  conversationId: 'new',
  conversations: [
    { id: 1, title: 'Project Alpha' },
    { id: 2, title: 'Research Notes' },
  ],
  variables: [],
  onNameChange: noop,
  onPromptChange: noop,
  onConversationIdChange: noop,
}

const meta: Meta<typeof PromptSection> = {
  title: 'Scheduler/TaskForm/PromptSection',
  component: PromptSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof PromptSection>

export const Default: Story = {}

export const WithExistingConversation: Story = {
  args: {
    conversationId: 2,
  },
}

export const WithVariables: Story = {
  args: {
    variables: [
      { name: 'date', argsHint: '', description: 'Current date in YYYY-MM-DD format', source: 'builtin' },
      { name: 'time', argsHint: '', description: 'Current time in HH:MM format', source: 'builtin' },
      { name: 'mood', argsHint: 'happy|sad', description: 'Custom mood variable', source: 'custom' },
    ],
  },
}
