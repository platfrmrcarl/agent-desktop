import type { IntervalUnit, PreRunAction } from '../../types'

const VALID_PRE_RUN_ACTIONS: readonly PreRunAction[] = ['none', 'clear', 'compact']
const VALID_INTERVAL_UNITS: readonly IntervalUnit[] = ['minutes', 'hours', 'days']

export function validatePreRunAction(value: unknown): PreRunAction {
  if (typeof value !== 'string' || !VALID_PRE_RUN_ACTIONS.includes(value as PreRunAction)) {
    throw new Error("pre_run_action must be 'none', 'clear', or 'compact'")
  }
  return value as PreRunAction
}

export function validateIntervalUnit(value: unknown): IntervalUnit {
  if (!VALID_INTERVAL_UNITS.includes(value as IntervalUnit)) {
    throw new Error('interval_unit must be minutes, hours, or days')
  }
  return value as IntervalUnit
}

export function validateScheduleTime(value: unknown): void {
  if (value && !/^\d{2}:\d{2}$/.test(value as string)) {
    throw new Error('schedule_time must be HH:MM format')
  }
}
