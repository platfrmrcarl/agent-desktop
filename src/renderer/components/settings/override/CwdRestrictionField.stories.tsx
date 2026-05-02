import type { Meta, StoryObj } from '@storybook/react'
import { CwdRestrictionField, type CwdRestrictionFieldProps } from './CwdRestrictionField'

const noop = () => {}

const baseArgs: CwdRestrictionFieldProps = {
  draftValue: undefined,
  inheritedValue: 'true',
  inheritedSource: 'Global',
  onToggle: noop,
  onChange: noop,
}

const meta: Meta<typeof CwdRestrictionField> = {
  title: 'Settings/Override/CwdRestrictionField',
  component: CwdRestrictionField,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof CwdRestrictionField>

export const Inherited: Story = {}

export const InheritedDisabled: Story = {
  args: {
    inheritedValue: 'false',
  },
}

export const OverriddenEnabled: Story = {
  args: {
    draftValue: 'true',
  },
}

export const OverriddenDisabled: Story = {
  args: {
    draftValue: 'false',
  },
}
