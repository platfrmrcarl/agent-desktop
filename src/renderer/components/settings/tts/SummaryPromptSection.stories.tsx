import type { Meta, StoryObj } from '@storybook/react'
import { SummaryPromptSection } from './SummaryPromptSection'

const noop = () => {}

const PRESET_MODELS = [
  { value: 'claude-haiku-4-5', label: 'Claude Haiku' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet' },
  { value: 'claude-opus-4-5', label: 'Claude Opus' },
]

const meta: Meta<typeof SummaryPromptSection> = {
  title: 'Settings/TTS/SummaryPromptSection',
  component: SummaryPromptSection,
  args: {
    responseMode: 'summary',
    summaryModel: 'claude-haiku-4-5',
    summaryPrompt: '',
    fetchedModels: PRESET_MODELS,
    onSummaryModelChange: noop,
    onSummaryPromptChange: noop,
  },
}

export default meta
type Story = StoryObj<typeof SummaryPromptSection>

export const Default: Story = {}

export const WithCustomPrompt: Story = {
  args: {
    summaryPrompt: 'Briefly summarize in one sentence: {response}',
  },
}

export const CustomModel: Story = {
  args: {
    summaryModel: 'gpt-4o',
  },
}

export const HiddenWhenOff: Story = {
  args: {
    responseMode: 'off',
  },
}
