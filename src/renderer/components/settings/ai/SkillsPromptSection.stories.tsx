import type { Meta, StoryObj } from '@storybook/react'
import { SkillsPromptSection, type SkillsPromptSectionProps } from './SkillsPromptSection'

const noop = () => {}

const baseArgs: SkillsPromptSectionProps = {
  skills: 'user',
  skillsEnabled: 'true',
  skillsIncludePlugins: 'false',
  disabledSkills: [],
  discoveredSkills: [],
  skillsOverhead: null,
  defaultSystemPrompt: '',
  onSkillsChange: noop,
  onSkillsEnabledChange: noop,
  onSkillsIncludePluginsChange: noop,
  onDisabledSkillsChange: noop,
  onDefaultSystemPromptChange: noop,
}

const meta: Meta<typeof SkillsPromptSection> = {
  title: 'Settings/AI/SkillsPromptSection',
  component: SkillsPromptSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof SkillsPromptSection>

export const SkillsOff: Story = {
  args: { skills: 'off', skillsEnabled: 'false' },
}

export const UserScopeWithDiscoveredSkills: Story = {
  args: {
    skills: 'user',
    skillsEnabled: 'true',
    discoveredSkills: [
      { name: 'graphify', description: 'turn input into a knowledge graph', source: 'skill' },
      { name: 'release-manager', description: 'automate releases', source: 'skill' },
      { name: 'simplify', description: 'review and simplify changed code', source: 'skill' },
    ],
    disabledSkills: ['simplify'],
    skillsOverhead: {
      off: { tokens: 0, count: 0 },
      user: { tokens: 4200, count: 14 },
      project: { tokens: 5800, count: 21 },
      local: { tokens: 6100, count: 23 },
    },
  },
}

export const WithLargeSystemPrompt: Story = {
  args: {
    defaultSystemPrompt:
      'You are a senior engineer. Always think before answering. Prefer concise, well-reasoned responses with concrete code samples.',
  },
}
