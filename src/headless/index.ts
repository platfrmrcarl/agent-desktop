/**
 * Headless entry point for Agent Desktop core engine.
 *
 * Runs without Electron — no UI, no BrowserWindow, no tray.
 * Useful for: CLI tools, background services, testing, embedding as a library.
 *
 * Usage:
 *   node out/headless/index.js --server
 *   node out/headless/index.js --discord
 *   node out/headless/index.js --server --discord --port 3484
 *   node out/headless/index.js --tick
 *   node out/headless/index.js --run-task 42
 */

import { resolve, join } from 'path'
import { homedir } from 'os'
import { AgentEngine, noopHookRunner, noopPlatformIO, noopSystemUI } from '../core'
import type { Broadcaster } from '../core'
import { addBroadcastHandler } from '../core/utils/broadcast'
import { enrichHeadlessEnv } from './headlessEnv'

// ─── CLI parsing ─────────────────────────────────────

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const args = process.argv.slice(2)
const flags = {
  server: args.includes('--server'),
  discord: args.includes('--discord'),
  tick: args.includes('--tick'),
  runTask: args.includes('--run-task'),
  port: getArgValue(args, '--port'),
  accessMode: getArgValue(args, '--access-mode') as 'lan' | 'all' | undefined,
}

// ─── Mode validation ─────────────────────────────────

const isLongRunning = flags.server || flags.discord
const isOneShot = flags.tick || flags.runTask

function fatal(err: unknown): never {
  console.error('[headless] Fatal:', err)
  process.exit(1)
}

if (isLongRunning && isOneShot) {
  console.error('[headless] Error: --server/--discord cannot be combined with --tick/--run-task')
  process.exit(1)
}

// ─── Paths ───────────────────────────────────────────

const DEFAULT_DB_PATH = join(homedir(), '.config', 'agent-desktop', 'agent.db')
const DEFAULT_THEMES_DIR = join(homedir(), '.agent-desktop', 'themes')
const DEFAULT_SSL_DIR = join(homedir(), '.config', 'agent-desktop', 'ssl')

// ─── CLI dispatch ─────────────────────────────────────

if (isLongRunning) {
  runServices().catch(fatal)
} else if (isOneShot) {
  import('./taskRunner').then(({ main }) => main(args)).catch(fatal)
} else {
  runInteractive().catch(fatal)
}

// ─── Service mode ─────────────────────────────────────

async function runServices(): Promise<void> {
  enrichHeadlessEnv()

  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR
  const sslDir = DEFAULT_SSL_DIR
  const rendererDir = resolve(__dirname, '../renderer')

  console.log(`[headless] Starting Agent Engine...`)
  console.log(`[headless] DB: ${dbPath}`)

  // WS broadcaster — wired after server starts
  let wsBroadcast: ((channel: string, ...args: unknown[]) => void) | null = null
  const cleanups: Array<() => void> = []

  const broadcaster: Broadcaster = {
    broadcast(channel: string, ...args: unknown[]): void {
      wsBroadcast?.(channel, ...args)
    },
  }

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster,
    hookRunner: noopHookRunner,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })

  await engine.init()
  console.log(`[headless] Engine initialized. ${engine.conversations.list().length} conversations in DB.`)

  const dispatch = engine.dispatch

  if (flags.server) {
    const { startServer, getWsBroadcaster } = await import('../core/services/webServer')

    // Read server settings from DB, CLI flags override
    const settings = engine.settings.getAll()
    const serverPort = flags.port
      ? parseInt(flags.port, 10)
      : (parseInt(settings.server_port, 10) || 3484)
    const serverAccessMode = flags.accessMode
      || (settings.server_accessMode === 'all' ? 'all' : 'lan')
    const serverShortCode = settings.server_shortCode || undefined

    const result = await startServer(serverPort, {
      sslDir,
      rendererDir,
      dispatch,
      shortCode: serverShortCode,
      accessMode: serverAccessMode,
      webPassword: engine.webPassword,
    })
    wsBroadcast = getWsBroadcaster() ?? null

    // Wire stream chunks (sendChunk → broadcast utility → WS clients)
    cleanups.push(addBroadcastHandler((channel, ...args) => {
      wsBroadcast?.(channel, ...args)
    }))

    console.log(`[headless] Web server running at ${result.url}`)
    console.log(`[headless] Access token: ${result.token}`)
  }

  if (flags.discord) {
    const { startBot } = await import('../core/services/discord')
    await startBot({ dispatch })
    console.log(`[headless] Discord bot started`)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[headless] Shutting down...`)
    for (const cleanup of cleanups) cleanup()
    await engine.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const running = [flags.server && 'server', flags.discord && 'discord'].filter(Boolean).join(' + ')
  console.log(`[headless] Running: ${running}. Press Ctrl+C to exit.`)
}

// ─── Interactive mode ─────────────────────────────────

const consoleBroadcaster: Broadcaster = {
  broadcast(channel: string, data: unknown): void {
    console.log(`[broadcast] ${channel}:`, JSON.stringify(data, null, 2).slice(0, 200))
  },
}

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
