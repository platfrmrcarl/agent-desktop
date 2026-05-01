import type { Meta, StoryObj } from '@storybook/react'
import { CwdWhitelistField, type CwdWhitelistFieldProps } from './CwdWhitelistField'

const noop = () => {}

const SAMPLE_ENTRIES = [
  { path: '/home/user/projects', access: 'readwrite' as const },
  { path: '/home/user/notes', access: 'read' as const },
]

const baseArgs: CwdWhitelistFieldProps = {
  isCwdWhitelistOverridden: false,
  cwdWhitelistDraft: [],
  cwdWhitelistInherited: [],
  inheritedSource: 'Global',
  onToggleCwdWhitelistOverride: noop,
  onCwdWhitelistChange: noop,
}

const meta: Meta<typeof CwdWhitelistField> = {
  title: 'Settings/Override/CwdWhitelistField',
  component: CwdWhitelistField,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof CwdWhitelistField>

export const InheritedEmpty: Story = {}

export const InheritedWithEntries: Story = {
  args: {
    cwdWhitelistInherited: SAMPLE_ENTRIES,
  },
}

export const Overridden: Story = {
  args: {
    isCwdWhitelistOverridden: true,
    cwdWhitelistDraft: SAMPLE_ENTRIES,
  },
}
