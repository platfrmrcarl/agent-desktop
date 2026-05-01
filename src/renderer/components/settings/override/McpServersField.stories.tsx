import type { Meta, StoryObj } from '@storybook/react'
import { McpServersField, type McpServersFieldProps } from './McpServersField'

const noop = () => {}

const SERVERS = [
  { name: 'filesystem' },
  { name: 'github' },
  { name: 'postgres' },
]

const baseArgs: McpServersFieldProps = {
  mcpServers: SERVERS,
  mcpDisabledDraft: [],
  mcpDisabledInherited: [],
  isMcpOverridden: false,
  inheritedSource: 'Global',
  onToggleMcpOverride: noop,
  onToggleMcpServer: noop,
}

const meta: Meta<typeof McpServersField> = {
  title: 'Settings/Override/McpServersField',
  component: McpServersField,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof McpServersField>

export const Inherited: Story = {}

export const Overridden: Story = {
  args: {
    isMcpOverridden: true,
  },
}

export const OverriddenWithSomeDisabled: Story = {
  args: {
    isMcpOverridden: true,
    mcpDisabledDraft: ['github'],
  },
}

export const InheritedPartiallyDisabled: Story = {
  args: {
    mcpDisabledInherited: ['postgres'],
  },
}
