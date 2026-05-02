import type { Meta, StoryObj } from '@storybook/react'
import { SettingSourcesRow, type SettingSourcesRowProps } from './SettingSourcesRow'

const noop = () => {}

const baseArgs: SettingSourcesRowProps = {
  skills: 'user',
  skillsOverhead: null,
  onSkillsChange: noop,
}

const meta: Meta<typeof SettingSourcesRow> = {
  title: 'Settings/AI/Skills/SettingSourcesRow',
  component: SettingSourcesRow,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof SettingSourcesRow>

export const Default: Story = {}

export const ScopeOff: Story = {
  args: { skills: 'off' },
}

export const WithOverhead: Story = {
  args: {
    skills: 'project',
    skillsOverhead: {
      off: { tokens: 0, count: 0 },
      user: { tokens: 4200, count: 14 },
      project: { tokens: 5800, count: 21 },
      local: { tokens: 6100, count: 23 },
    },
  },
}

export const LocalScopeHighOverhead: Story = {
  args: {
    skills: 'local',
    skillsOverhead: {
      off: { tokens: 0, count: 0 },
      user: { tokens: 1200, count: 4 },
      project: { tokens: 3000, count: 10 },
      local: { tokens: 12500, count: 47 },
    },
  },
}
