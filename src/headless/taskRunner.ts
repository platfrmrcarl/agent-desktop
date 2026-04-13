/**
 * Headless task runner — executes scheduled tasks without Electron.
 * Invoked by the OS scheduler (cron/launchd/schtasks) via:
 *   node taskRunner.js --tick         # Check + execute all due tasks
 *   node taskRunner.js --run-task 42  # Execute a specific task by ID
 */

import { resolve, join } from 'path'
import { homedir } from 'os'
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs'
import { AgentEngine } from '../core'
import type { Broadcaster } from '../core'
import { executeTask } from '../core/services/taskExecutor'
import { createHeadlessContext } from './headlessTaskContext'
import { enrichHeadlessEnv } from './headlessEnv'

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const LOG_PATH = join(homedir(), '.config', 'agent-desktop', 'scheduler-headless.log')
const HEADLESS_DIR = join(homedir(), '.config', 'agent-desktop', 'headless')
const WASM_PATH = join(HEADLESS_DIR, 'sql-wasm.wasm')

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  process.stderr.write(line)
  try {
    mkdirSync(join(homedir(), '.config', 'agent-desktop'), { recursive: true })
    appendFileSync(LOG_PATH, line)
  } catch { /* ignore */ }
}

const silentBroadcaster: Broadcaster = {
  broadcast(): void { /* no-op in headless runner */ },
}

// ─── Tick mode ─────────────────────────────────────────────

async function runTick(): Promise<void> {
  log('[tick] Starting scheduler tick')

  const dbPath = resolve(process.env.AGENT_DB_PATH || DEFAULT_DB_PATH)

  const engine = new AgentEngine({
    dbPath,
    wasmPath: WASM_PATH,
    themesDir: join(homedir(), '.agent-desktop', 'themes'),
    broadcaster: silentBroadcaster,
  })

  await engine.init()
  log(`[tick] Engine initialized, DB: ${dbPath}`)

  const scheduler = engine.scheduler

  // Reset stuck tasks (safe on every tick)
  scheduler.recoverStuckTasks()

  // Check auto-theme (updates DB if needed)
  scheduler.checkAutoTheme()

  // Get due tasks
  const dueTasks = scheduler.getDueTasks()
  if (dueTasks.length === 0) {
    log('[tick] No due tasks, exiting')
    await engine.shutdown()
    process.exit(0)
  }

  log(`[tick] ${dueTasks.length} due task(s)`)
  const ctx = createHeadlessContext(engine.db as any)

  // Execute tasks sequentially (sql.js is single-process, no concurrency)
  for (const task of dueTasks) {
    log(`[tick] Executing task "${task.name}" (id=${task.id})`)
    try {
      await executeTask(scheduler, ctx, task)
    } catch (err) {
      log(`[tick] Task ${task.id} error: ${err instanceof Error ? err.message : err}`)
    }
  }

  log('[tick] All tasks processed, shutting down')
  await engine.shutdown()
}

// ─── Run-task mode ─────────────────────────────────────────

async function runTask(taskId: number): Promise<void> {
  log(`[run-task] Running task ${taskId}`)

  const dbPath = resolve(process.env.AGENT_DB_PATH || DEFAULT_DB_PATH)

  const engine = new AgentEngine({
    dbPath,
    wasmPath: WASM_PATH,
    themesDir: join(homedir(), '.agent-desktop', 'themes'),
    broadcaster: silentBroadcaster,
  })

  await engine.init()
  const scheduler = engine.scheduler

  const task = scheduler.get(taskId)
  if (!task) {
    log(`[run-task] Task ${taskId} not found`)
    await engine.shutdown()
    process.exit(1)
  }
  if (!task.enabled) {
    log(`[run-task] Task ${taskId} is disabled`)
    await engine.shutdown()
    process.exit(1)
  }

  const ctx = createHeadlessContext(engine.db as any)
  await executeTask(scheduler, ctx, task)

  log(`[run-task] Task ${taskId} completed`)
  await engine.shutdown()
}

// ─── CLI dispatch ──────────────────────────────────────────

export async function main(args: string[]): Promise<void> {
  enrichHeadlessEnv()

  // Resolve NODE_PATH so external packages (claude-agent-sdk) can be found
  const nodePathFile = join(HEADLESS_DIR, 'node_path.txt')
  if (existsSync(nodePathFile)) {
    const extraNodePath = readFileSync(nodePathFile, 'utf-8').trim()
    process.env.NODE_PATH = extraNodePath + (process.env.NODE_PATH ? `:${process.env.NODE_PATH}` : '')
    // Force Node to re-evaluate module paths
    require('module').Module._initPaths()
  }

  if (args.includes('--tick')) {
    await runTick()
  } else if (args.includes('--run-task')) {
    const idx = args.indexOf('--run-task')
    const taskId = parseInt(args[idx + 1], 10)
    if (isNaN(taskId) || taskId <= 0) {
      console.error('Usage: --run-task <id>')
      process.exit(1)
    }
    await runTask(taskId)
  } else {
    console.error('Usage: node taskRunner.js --tick | --run-task <id>')
    process.exit(1)
  }
}
