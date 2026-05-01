import type { Meta, StoryObj } from '@storybook/react'
import { ToggleRow, type ToggleRowProps } from './ToggleRow'

const noop = () => {}

const baseArgs: ToggleRowProps = {
  label: 'Skills',
  description: 'Allow the AI to invoke discovered skills.',
  checked: true,
  disabled: false,
  ariaLabel: 'Toggle skills',
  onChange: noop,
}

const meta: Meta<typeof ToggleRow> = {
  title: 'Settings/AI/Skills/ToggleRow',
  component: ToggleRow,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof ToggleRow>

export const EnabledOn: Story = {}

export const EnabledOff: Story = {
  args: { checked: false },
}

export const Disabled: Story = {
  args: { checked: false, disabled: true },
}
