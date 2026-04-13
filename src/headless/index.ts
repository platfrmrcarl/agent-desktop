/**
 * Headless entry point for Agent Desktop core engine.
 *
 * Runs without Electron — no UI, no BrowserWindow, no tray.
 * Useful for: CLI tools, background services, testing, embedding as a library.
 *
 * Usage:
 *   npx tsx src/headless/index.ts
 *   node out/headless/index.js
 */

import { resolve, join } from 'path'
import { homedir } from 'os'
import { AgentEngine, noopPlatformIO, noopSystemUI } from '../core'
import type { Broadcaster } from '../core'

// ─── CLI dispatch ───────────────────────────────────────────
// --tick or --run-task → delegate to task runner (no interactive mode)

const args = process.argv.slice(2)
if (args.includes('--tick') || args.includes('--run-task')) {
  import('./taskRunner').then(({ main }) => main(args)).catch((err) => {
    console.error('[headless] Fatal:', err)
    process.exit(1)
  })
} else {
  // Interactive mode — engine ready, Ctrl+C to exit
  runInteractive().catch((err) => {
    console.error('[headless] Fatal:', err)
    process.exit(1)
  })
}

// ─── Interactive mode ───────────────────────────────────────

const consoleBroadcaster: Broadcaster = {
  broadcast(channel: string, data: unknown): void {
    console.log(`[broadcast] ${channel}:`, JSON.stringify(data, null, 2).slice(0, 200))
  },
}

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const DEFAULT_THEMES_DIR = join(homedir(), '.agent-desktop', 'themes')

async function runInteractive(): Promise<void> {
  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  console.log(`[headless] Starting Agent Engine...`)
  console.log(`[headless] DB: ${dbPath}`)
  console.log(`[headless] Themes: ${themesDir}`)

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster: consoleBroadcaster,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })

  await engine.init()
  console.log(`[headless] Engine initialized. ${engine.conversations.list().length} conversations in DB.`)

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[headless] Shutting down...`)
    await engine.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log(`[headless] Engine ready. Press Ctrl+C to exit.`)
  console.log(`[headless] Available services: settings, folders, conversations, messages, tools, shortcuts, themes, mcp, scheduler`)
}
