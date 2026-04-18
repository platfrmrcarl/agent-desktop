import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'
import { DEFAULT_MODEL } from '../types/constants'
import type { ScheduledTask, CreateScheduledTask, IntervalUnit, PreRunAction } from '../types'

const VALID_PRE_RUN_ACTIONS: readonly PreRunAction[] = ['none', 'clear', 'compact']

function validatePreRunAction(value: unknown): PreRunAction {
  if (typeof value !== 'string' || !VALID_PRE_RUN_ACTIONS.includes(value as PreRunAction)) {
    throw new Error("pre_run_action must be 'none', 'clear', or 'compact'")
  }
  return value as PreRunAction
}

// ─── Pure computations ─────────────────────────────────────

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

export function getExpectedThemeFilename(
  dayTime: string,
  nightTime: string,
  dayTheme: string,
  nightTheme: string,
  now: Date = new Date()
): string {
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const [dayH, dayM] = dayTime.split(':').map(Number)
  const [nightH, nightM] = nightTime.split(':').map(Number)
  const dayMinutes = dayH * 60 + dayM
  const nightMinutes = nightH * 60 + nightM

  if (dayMinutes === nightMinutes) return dayTheme

  if (dayMinutes < nightMinutes) {
    return (currentMinutes >= dayMinutes && currentMinutes < nightMinutes) ? dayTheme : nightTheme
  }
  return (currentMinutes >= dayMinutes || currentMinutes < nightMinutes) ? dayTheme : nightTheme
}

// ─── DB row mapping ────────────────────────────────────────

function rowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as number,
    name: row.name as string,
    prompt: row.prompt as string,
    conversation_id: row.conversation_id as number,
    conversation_title: (row.conversation_title as string) || undefined,
    enabled: Boolean(row.enabled),
    interval_value: row.interval_value as number,
    interval_unit: row.interval_unit as IntervalUnit,
    schedule_time: (row.schedule_time as string) || null,
    catch_up: Boolean(row.catch_up),
    max_runs: row.max_runs != null ? (row.max_runs as number) : null,
    last_run_at: (row.last_run_at as string) || null,
    next_run_at: (row.next_run_at as string) || null,
    last_status: (row.last_status as ScheduledTask['last_status']) || null,
    last_error: (row.last_error as string) || null,
    run_count: (row.run_count as number) || 0,
    notify_desktop: Boolean(row.notify_desktop ?? 1),
    notify_voice: Boolean(row.notify_voice ?? 0),
    pre_run_action: (row.pre_run_action as PreRunAction) || 'none',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

// ─── SQL queries ───────────────────────────────────────────

const LIST_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  ORDER BY t.created_at DESC
`

const GET_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  WHERE t.id = ?
`

const DUE_QUERY = `
  SELECT t.*, c.title AS conversation_title
  FROM scheduled_tasks t
  LEFT JOIN conversations c ON c.id = t.conversation_id
  WHERE t.enabled = 1
    AND t.next_run_at <= ?
    AND (t.last_status IS NULL OR t.last_status != 'running')
`

// ─── SchedulerService ──────────────────────────────────────

export class SchedulerService {
  constructor(private db: Database.Database) {}

  list(): ScheduledTask[] {
    return (this.db.prepare(LIST_QUERY).all() as Record<string, unknown>[]).map(rowToTask)
  }

  get(id: number): ScheduledTask | null {
    validatePositiveInt(id, 'id')
    const row = this.db.prepare(GET_QUERY).get(id) as Record<string, unknown> | undefined
    return row ? rowToTask(row) : null
  }

  getDueTasks(now: Date = new Date()): ScheduledTask[] {
    return (this.db.prepare(DUE_QUERY).all(now.toISOString()) as Record<string, unknown>[]).map(rowToTask)
  }

  create(data: CreateScheduledTask): ScheduledTask {
    validateString(data.name, 'name', 200)
    validateString(data.prompt, 'prompt', 10_000_000)
    validatePositiveInt(data.interval_value, 'interval_value')

    const validUnits: IntervalUnit[] = ['minutes', 'hours', 'days']
    if (!validUnits.includes(data.interval_unit)) {
      throw new Error('interval_unit must be minutes, hours, or days')
    }
    if (data.schedule_time && !/^\d{2}:\d{2}$/.test(data.schedule_time)) {
      throw new Error('schedule_time must be HH:MM format')
    }

    // Resolve or create conversation
    let conversationId: number
    if (data.conversation_id) {
      validatePositiveInt(data.conversation_id, 'conversation_id')
      const conv = this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(data.conversation_id)
      if (!conv) throw new Error('Conversation not found')
      conversationId = data.conversation_id
    } else {
      const modelRow = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
      const model = modelRow?.value || DEFAULT_MODEL
      const defaultFolder = this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
      const convResult = this.db.prepare(
        "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(data.name, defaultFolder?.id ?? null, model)
      conversationId = convResult.lastInsertRowid as number
    }

    const now = new Date()
    const nextRun = computeNextRun(data.interval_value, data.interval_unit, data.schedule_time || null, now)
    const nowIso = now.toISOString()

    if (data.max_runs !== undefined && data.max_runs !== null) {
      validatePositiveInt(data.max_runs, 'max_runs')
    }

    const preRunAction: PreRunAction = data.pre_run_action !== undefined
      ? validatePreRunAction(data.pre_run_action)
      : 'none'

    const result = this.db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit,
        schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action,
        next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.prompt,
      conversationId,
      data.interval_value,
      data.interval_unit,
      data.schedule_time || null,
      data.catch_up !== false ? 1 : 0,
      data.max_runs ?? null,
      data.notify_desktop !== false ? 1 : 0,
      data.notify_voice ? 1 : 0,
      preRunAction,
      nextRun,
      nowIso,
      nowIso,
    )

    return this.get(result.lastInsertRowid as number)!
  }

  update(id: number, data: Partial<CreateScheduledTask>): void {
    validatePositiveInt(id, 'id')

    const existing = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) throw new Error('Task not found')

    const updates: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) {
      validateString(data.name, 'name', 200)
      updates.push('name = ?')
      values.push(data.name)
    }
    if (data.prompt !== undefined) {
      validateString(data.prompt, 'prompt', 10_000_000)
      updates.push('prompt = ?')
      values.push(data.prompt)
    }
    if (data.conversation_id !== undefined) {
      validatePositiveInt(data.conversation_id, 'conversation_id')
      const conv = this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(data.conversation_id)
      if (!conv) throw new Error('Conversation not found')
      updates.push('conversation_id = ?')
      values.push(data.conversation_id)
    }
    if (data.interval_value !== undefined) {
      validatePositiveInt(data.interval_value, 'interval_value')
      updates.push('interval_value = ?')
      values.push(data.interval_value)
    }
    if (data.interval_unit !== undefined) {
      const validUnits: IntervalUnit[] = ['minutes', 'hours', 'days']
      if (!validUnits.includes(data.interval_unit)) throw new Error('Invalid interval_unit')
      updates.push('interval_unit = ?')
      values.push(data.interval_unit)
    }
    if (data.schedule_time !== undefined) {
      if (data.schedule_time && !/^\d{2}:\d{2}$/.test(data.schedule_time)) {
        throw new Error('schedule_time must be HH:MM format')
      }
      updates.push('schedule_time = ?')
      values.push(data.schedule_time || null)
    }
    if (data.catch_up !== undefined) {
      updates.push('catch_up = ?')
      values.push(data.catch_up ? 1 : 0)
    }
    if (data.max_runs !== undefined) {
      if (data.max_runs !== null) validatePositiveInt(data.max_runs, 'max_runs')
      updates.push('max_runs = ?')
      values.push(data.max_runs ?? null)
    }
    if (data.notify_desktop !== undefined) {
      updates.push('notify_desktop = ?')
      values.push(data.notify_desktop ? 1 : 0)
    }
    if (data.notify_voice !== undefined) {
      updates.push('notify_voice = ?')
      values.push(data.notify_voice ? 1 : 0)
    }
    if (data.pre_run_action !== undefined) {
      const action = validatePreRunAction(data.pre_run_action)
      updates.push('pre_run_action = ?')
      values.push(action)
    }

    if (updates.length === 0) return

    // Recompute next_run_at with potentially updated schedule
    const iv = (data.interval_value ?? existing.interval_value) as number
    const iu = (data.interval_unit ?? existing.interval_unit) as IntervalUnit
    const st = data.schedule_time !== undefined ? (data.schedule_time || null) : (existing.schedule_time as string | null)
    const nextRun = computeNextRun(iv, iu, st)
    updates.push('next_run_at = ?')
    values.push(nextRun)

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now)

    values.push(id)
    this.db.prepare(`UPDATE scheduled_tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  }

  delete(id: number): void {
    validatePositiveInt(id, 'id')
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  }

  toggle(id: number, enabled: boolean): void {
    validatePositiveInt(id, 'id')
    const now = new Date().toISOString()

    if (enabled) {
      const row = this.db.prepare('SELECT interval_value, interval_unit, schedule_time FROM scheduled_tasks WHERE id = ?')
        .get(id) as { interval_value: number; interval_unit: IntervalUnit; schedule_time: string | null } | undefined
      if (!row) throw new Error('Task not found')
      const nextRun = computeNextRun(row.interval_value, row.interval_unit, row.schedule_time)
      this.db.prepare('UPDATE scheduled_tasks SET enabled = 1, next_run_at = ?, updated_at = ? WHERE id = ?')
        .run(nextRun, now, id)
    } else {
      this.db.prepare('UPDATE scheduled_tasks SET enabled = 0, updated_at = ? WHERE id = ?')
        .run(now, id)
    }
  }

  conversationTasks(conversationId: number): number[] {
    validatePositiveInt(conversationId, 'conversationId')
    const rows = this.db.prepare('SELECT id FROM scheduled_tasks WHERE conversation_id = ?').all(conversationId) as { id: number }[]
    return rows.map(r => r.id)
  }

  // ─── Status transitions ────────────────────────────────────

  markRunning(id: number): void {
    const now = new Date().toISOString()
    this.db.prepare('UPDATE scheduled_tasks SET last_status = ?, updated_at = ? WHERE id = ?')
      .run('running', now, id)
  }

  markSuccess(id: number, task: ScheduledTask): void {
    const now = new Date().toISOString()
    const reachedLimit = task.max_runs !== null && task.run_count + 1 >= task.max_runs
    if (reachedLimit) {
      this.db.prepare(`
        UPDATE scheduled_tasks
        SET last_run_at = ?, next_run_at = NULL, last_status = 'success', last_error = NULL,
            run_count = run_count + 1, enabled = 0, updated_at = ?
        WHERE id = ?
      `).run(now, now, id)
    } else {
      const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
      this.db.prepare(`
        UPDATE scheduled_tasks
        SET last_run_at = ?, next_run_at = ?, last_status = 'success', last_error = NULL,
            run_count = run_count + 1, updated_at = ?
        WHERE id = ?
      `).run(now, nextRun, now, id)
    }
  }

  markError(id: number, task: ScheduledTask, error: string): void {
    const now = new Date().toISOString()
    const nextRun = computeNextRun(task.interval_value, task.interval_unit, task.schedule_time)
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = ?, next_run_at = ?, last_status = 'error', last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(now, nextRun, error, now, id)
  }

  // ─── Startup recovery ──────────────────────────────────────

  /** Reset tasks stuck in 'running' state (app crashed mid-execution) */
  recoverStuckTasks(): void {
    const now = new Date().toISOString()
    this.db.prepare(
      "UPDATE scheduled_tasks SET last_status = 'error', last_error = 'App restarted during execution', updated_at = ? WHERE enabled = 1 AND last_status = 'running'"
    ).run(now)
  }

  /** Handle missed runs: catch-up or recompute from now */
  recomputeMissedRuns(): void {
    const tasks = this.db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all() as Record<string, unknown>[]
    const now = new Date()
    const nowIso = now.toISOString()

    for (const row of tasks) {
      if (row.next_run_at && new Date(row.next_run_at as string).getTime() < now.getTime()) {
        if (row.catch_up) {
          this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
            .run(nowIso, row.id)
        } else {
          const nextRun = computeNextRun(
            row.interval_value as number,
            row.interval_unit as IntervalUnit,
            row.schedule_time as string | null,
            now
          )
          this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?')
            .run(nextRun, row.id)
        }
      }
    }
  }

  /** Reassign scheduled tasks to new conversations before a conversation is deleted */
  reassignOrphanedTasks(conversationId: number): void {
    const tasks = this.db.prepare('SELECT id, name FROM scheduled_tasks WHERE conversation_id = ?')
      .all(conversationId) as { id: number; name: string }[]

    if (tasks.length === 0) return

    const modelRow = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
    const model = modelRow?.value || DEFAULT_MODEL
    const defaultFolder = this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
    const now = new Date().toISOString()

    for (const task of tasks) {
      const convResult = this.db.prepare(
        "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
      ).run(task.name, defaultFolder?.id ?? null, model)
      this.db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
        .run(convResult.lastInsertRowid as number, now, task.id)
      console.log(`[scheduler] Task "${task.name}" (id=${task.id}): conversation ${conversationId} deleted, reassigned to new conversation ${convResult.lastInsertRowid}`)
    }
  }

  /** Ensure the task's conversation exists. Recreates if deleted. Returns updated task if conversation changed. */
  ensureConversation(task: ScheduledTask): ScheduledTask {
    const conv = this.db.prepare('SELECT id FROM conversations WHERE id = ?').get(task.conversation_id) as { id: number } | undefined
    if (conv) return task

    const modelRow = this.db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value: string } | undefined
    const model = modelRow?.value || DEFAULT_MODEL
    const defaultFolder = this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number } | undefined
    const now = new Date().toISOString()

    const convResult = this.db.prepare(
      "INSERT INTO conversations (title, folder_id, model, updated_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(task.name, defaultFolder?.id ?? null, model)
    const newConvId = convResult.lastInsertRowid as number

    this.db.prepare('UPDATE scheduled_tasks SET conversation_id = ?, updated_at = ? WHERE id = ?')
      .run(newConvId, now, task.id)

    console.log(`[scheduler] Task "${task.name}" (id=${task.id}): conversation ${task.conversation_id} deleted, created new conversation ${newConvId}`)
    return { ...task, conversation_id: newConvId }
  }

  /** Check if conversation still exists (used during streaming to verify it wasn't deleted) */
  conversationExists(conversationId: number): boolean {
    return this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId) !== undefined
  }

  /** Check if any enabled tasks exist */
  hasEnabledTasks(): boolean {
    const row = this.db.prepare('SELECT 1 FROM scheduled_tasks WHERE enabled = 1 LIMIT 1').get()
    return row !== undefined
  }

  /** Get auto-theme settings and check if switch is needed */
  checkAutoTheme(): string | null {
    const getVal = (key: string): string | null => {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
      return row?.value ?? null
    }

    if (getVal('autoTheme_enabled') !== 'true') return null

    const dayTheme = getVal('autoTheme_dayTheme')
    const nightTheme = getVal('autoTheme_nightTheme')
    const dayTime = getVal('autoTheme_dayTime') || '07:00'
    const nightTime = getVal('autoTheme_nightTime') || '21:00'

    if (!dayTheme || !nightTheme) return null

    const expected = getExpectedThemeFilename(dayTime, nightTime, dayTheme, nightTheme)
    const current = getVal('activeTheme')

    if (current === expected) return null

    this.db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('activeTheme', ?, datetime('now'))").run(expected)
    return expected
  }
}
