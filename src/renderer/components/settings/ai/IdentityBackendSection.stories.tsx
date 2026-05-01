import type { Meta, StoryObj } from '@storybook/react'
import { IdentityBackendSection, type IdentityBackendSectionProps } from './IdentityBackendSection'

const noop = () => {}

const baseArgs: IdentityBackendSectionProps = {
  agentName: 'Claude',
  agentLanguage: 'English',
  agentPersonality: 'concise and technical',
  sdkBackend: 'claude-agent-sdk',
  isClaudeBackend: true,
  piExtensionsDir: '',
  piExtensions: [],
  piDisabledExtensions: [],
  onAgentNameChange: noop,
  onAgentLanguageChange: noop,
  onAgentPersonalityChange: noop,
  onSdkBackendChange: noop,
  onPiExtensionsDirChange: noop,
  onPiDisabledExtensionsChange: noop,
  onBrowseExtensionsDir: noop,
}

const meta: Meta<typeof IdentityBackendSection> = {
  title: 'Settings/AI/IdentityBackendSection',
  component: IdentityBackendSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof IdentityBackendSection>

export const ClaudeBackend: Story = {}

export const PiBackendWithExtensions: Story = {
  args: {
    sdkBackend: 'pi',
    isClaudeBackend: false,
    piExtensionsDir: '~/.pi/agent/extensions/',
    piExtensions: [
      { name: 'echo-tool', path: '/home/user/.pi/agent/extensions/echo.ts' },
      { name: 'clock-tool', path: '/home/user/.pi/agent/extensions/clock.ts' },
    ],
    piDisabledExtensions: ['/home/user/.pi/agent/extensions/clock.ts'],
  },
}

export const EmptyState: Story = {
  args: {
    agentName: '',
    agentLanguage: '',
    agentPersonality: '',
  },
}
