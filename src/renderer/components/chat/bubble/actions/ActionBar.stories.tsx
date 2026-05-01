import type { Meta, StoryObj } from '@storybook/react'
import { ActionBar } from './ActionBar'

const meta: Meta<typeof ActionBar> = {
  title: 'Chat/Bubble/ActionBar',
  component: ActionBar,
  parameters: { layout: 'centered' },
  args: {
    isUser: false,
    isLast: true,
    showTtsButton: false,
    isSpeakingThis: false,
    onCopy: () => console.log('copy'),
    onPlayTts: () => console.log('play tts'),
    onStopTts: () => console.log('stop tts'),
    onOpenTaskForm: () => console.log('open task form'),
  },
}

export default meta
type Story = StoryObj<typeof ActionBar>

export const AssistantLast: Story = {
  args: {
    isUser: false,
    isLast: true,
    onRegenerate: () => console.log('regenerate'),
    onFork: (id: number) => console.log('fork', id),
  },
}

export const AssistantWithTts: Story = {
  args: {
    isUser: false,
    isLast: true,
    showTtsButton: true,
    isSpeakingThis: false,
    onRegenerate: () => console.log('regenerate'),
  },
}

export const AssistantSpeaking: Story = {
  args: {
    isUser: false,
    isLast: true,
    showTtsButton: true,
    isSpeakingThis: true,
  },
}

export const UserMessage: Story = {
  args: {
    isUser: true,
    isLast: true,
    onStartEdit: () => console.log('edit'),
    onRetry: () => console.log('retry'),
  },
}

export const UserMessageTts: Story = {
  args: {
    isUser: true,
    isLast: true,
    showTtsButton: true,
    onStartEdit: () => console.log('edit'),
    onRetry: () => console.log('retry'),
  },
}
