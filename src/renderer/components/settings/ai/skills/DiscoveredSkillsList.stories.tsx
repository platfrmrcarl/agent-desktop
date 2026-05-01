import type { Meta, StoryObj } from '@storybook/react'
import { DiscoveredSkillsList, type DiscoveredSkillsListProps } from './DiscoveredSkillsList'

const noop = () => {}

const SAMPLE_SKILLS = [
  { name: 'graphify', description: 'turn input into a knowledge graph', source: 'skill' as const },
  { name: 'release-manager', description: 'automate releases', source: 'skill' as const },
  { name: 'simplify', description: 'review and simplify changed code', source: 'skill' as const },
]

const baseArgs: DiscoveredSkillsListProps = {
  discoveredSkills: SAMPLE_SKILLS,
  disabledSkills: [],
  onDisabledSkillsChange: noop,
}

const meta: Meta<typeof DiscoveredSkillsList> = {
  title: 'Settings/AI/Skills/DiscoveredSkillsList',
  component: DiscoveredSkillsList,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof DiscoveredSkillsList>

export const Default: Story = {}

export const WithSomeDisabled: Story = {
  args: { disabledSkills: ['simplify'] },
}

export const AllDisabled: Story = {
  args: { disabledSkills: ['graphify', 'release-manager', 'simplify'] },
}
