import type { Meta, StoryObj } from '@storybook/react'
import { ScheduleSection, type ScheduleSectionProps } from './ScheduleSection'

const noop = () => {}

const baseArgs: ScheduleSectionProps = {
  intervalValue: 1,
  intervalUnit: 'hours',
  scheduleTime: '',
  onIntervalValueChange: noop,
  onIntervalUnitChange: noop,
  onScheduleTimeChange: noop,
}

const meta: Meta<typeof ScheduleSection> = {
  title: 'Scheduler/TaskForm/ScheduleSection',
  component: ScheduleSection,
  args: baseArgs,
}

export default meta
type Story = StoryObj<typeof ScheduleSection>

export const Default: Story = {}

export const Daily: Story = {
  args: {
    intervalValue: 1,
    intervalUnit: 'days',
    scheduleTime: '',
  },
}

export const DailyWithTime: Story = {
  args: {
    intervalValue: 1,
    intervalUnit: 'days',
    scheduleTime: '08:30',
  },
}
