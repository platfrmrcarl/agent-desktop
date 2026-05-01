import type { IntervalUnit } from '../../types'

/**
 * Pure schedule arithmetic shared between scheduler.ts and its persistence
 * helper. Lives in the helper directory to avoid the helper → parent cycle.
 */
export function computeNextRun(
  intervalValue: number,
  intervalUnit: IntervalUnit,
  scheduleTime: string | null,
  fromTime: Date = new Date()
): string {
  // Truncate seconds — prevents drift from accumulating across ticks
  const from = new Date(fromTime)
  from.setSeconds(0, 0)
  const ms = from.getTime()

  if (intervalUnit === 'minutes') {
    return new Date(ms + intervalValue * 60_000).toISOString()
  }

  if (intervalUnit === 'hours') {
    return new Date(ms + intervalValue * 3_600_000).toISOString()
  }

  // days
  if (scheduleTime && /^\d{2}:\d{2}$/.test(scheduleTime)) {
    const [hours, minutes] = scheduleTime.split(':').map(Number)
    const next = new Date(from)
    next.setHours(hours, minutes, 0, 0)
    if (next.getTime() <= ms) {
      next.setDate(next.getDate() + intervalValue)
    }
    return next.toISOString()
  }

  return new Date(ms + intervalValue * 86_400_000).toISOString()
}
