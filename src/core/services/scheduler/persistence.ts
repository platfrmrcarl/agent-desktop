import type Database from 'better-sqlite3'
import type { IntervalUnit } from '../../types'
import { computeNextRun } from '../scheduler'

/** Apply a set of column=? assignments to scheduled_tasks for the given id. */
export function executeTaskUpdate(
  db: Database.Database,
  id: number,
  updates: string[],
  values: unknown[]
): void {
  const params = [...values, id]
  db.prepare(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params)
}

/** Delete a scheduled task by id. */
export function executeTaskDelete(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

/** Enable or disable a task. When enabling, recomputes next_run_at from now. */
export function executeTaskToggle(
  db: Database.Database,
  id: number,
  enabled: boolean,
  now: string
): void {
  if (enabled) {
    const row = db.prepare(
      'SELECT interval_value, interval_unit, schedule_time FROM scheduled_tasks WHERE id = ?'
    ).get(id) as { interval_value: number; interval_unit: IntervalUnit; schedule_time: string | null } | undefined
    if (!row) throw new Error('Task not found')
    const nextRun = computeNextRun(row.interval_value, row.interval_unit, row.schedule_time)
    db.prepare('UPDATE scheduled_tasks SET enabled = 1, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRun, now, id)
  } else {
    db.prepare('UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?')
      .run(now, id)
  }
}
