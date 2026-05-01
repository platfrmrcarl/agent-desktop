import type { Meta, StoryObj } from '@storybook/react'
import { AdvancedSection, type AdvancedSectionProps } from './AdvancedSection'

const noop = () => {}

const baseArgs: AdvancedSectionProps = {
  maxRunsMode: 'unlimited',
  maxRunsValue: 5,
  catchUp: true,
  notifyDesktop: true,
  notifyVoice: false,
  preRunAction: 'none',
  onMaxRunsModeChange: noop,
  onMaxRunsValueChange: noop,
  onCatchUpChange: noop,
  onNotifyDesktopChange: noop,
  onNotifyVoiceChange: noop,
  onPreRunActionChange: noop,
}

const meta: Meta<typeof AdvancedSection> = {
  title: 'Scheduler/TaskForm/AdvancedSection',
  component: AdvancedSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof AdvancedSection>

export const Default: Story = {}

export const RunOnce: Story = {
  args: {
    maxRunsMode: 'once',
  },
}

export const CustomRunsWithCompact: Story = {
  args: {
    maxRunsMode: 'custom',
    maxRunsValue: 10,
    preRunAction: 'compact',
  },
}
