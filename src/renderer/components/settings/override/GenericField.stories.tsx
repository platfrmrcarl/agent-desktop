import type { Meta, StoryObj } from '@storybook/react'
import { GenericField, type GenericFieldProps } from './GenericField'

const noop = () => {}

const selectDef = {
  key: 'ai_model',
  label: 'Model',
  type: 'select' as const,
  options: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5' },
  ],
}

const numberDef = {
  key: 'ai_maxTurns',
  label: 'Max Turns',
  type: 'number' as const,
  min: 0,
}

const textareaDef = {
  key: 'ai_defaultSystemPrompt',
  label: 'System Prompt',
  type: 'textarea' as const,
}

const baseArgs: GenericFieldProps = {
  def: selectDef,
  draftValue: undefined,
  inherited: 'claude-sonnet-4-6',
  source: 'Global',
  customModels: [],
  onToggle: noop,
  onChange: noop,
}

const meta: Meta<typeof GenericField> = {
  title: 'Settings/Override/GenericField',
  component: GenericField,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof GenericField>

export const SelectInherited: Story = {}

export const SelectOverridden: Story = {
  args: {
    draftValue: 'claude-haiku-3-5',
  },
}

export const NumberInherited: Story = {
  args: {
    def: numberDef,
    inherited: '10',
  },
}

export const NumberOverridden: Story = {
  args: {
    def: numberDef,
    draftValue: '20',
  },
}

export const TextareaInherited: Story = {
  args: {
    def: textareaDef,
    inherited: 'You are a helpful assistant.',
  },
}

export const TextareaOverridden: Story = {
  args: {
    def: textareaDef,
    draftValue: 'You are a coding expert.',
  },
}
