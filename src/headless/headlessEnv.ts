/**
 * Portable environment enrichment for headless mode.
 * Resolves CLAUDE_CONFIG_DIR, HOME, PATH, DBUS_SESSION_BUS_ADDRESS.
 * No Electron dependencies.
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

/**
 * Enrich process.env for headless execution (cron doesn't inherit user session env).
 * Must be called before DB init or SDK usage.
 */
export function enrichHeadlessEnv(): void {
  // Ensure HOME is set (cron sometimes strips it)
  if (!process.env.HOME) {
    process.env.HOME = homedir()
  }

  // Claude config dir — default to ~/.claude
  if (!process.env.CLAUDE_CONFIG_DIR) {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.claude')
  }

  // DBUS_SESSION_BUS_ADDRESS — needed for notify-send on Linux
  // Cron doesn't inherit it, but we can discover it from /run/user/<uid>/bus
  if (process.platform === 'linux' && !process.env.DBUS_SESSION_BUS_ADDRESS) {
    const uid = process.getuid?.()
    if (uid !== undefined) {
      const busPath = `/run/user/${uid}/bus`
      if (existsSync(busPath)) {
        process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`
      }
    }
  }

  // PATH enrichment — ensure common node locations are available
  const path = process.env.PATH || ''
  const extraPaths = [
    '/usr/local/bin',
    '/usr/bin',
    join(homedir(), '.nvm/versions/node') + '/*/bin', // not glob-resolved, just a hint
    join(homedir(), '.local/bin'),
  ].filter(p => !path.includes(p))

  if (extraPaths.length > 0) {
    process.env.PATH = [...extraPaths, path].join(':')
  }
}

/** Get the sessions base directory (where task CWDs live) */
export function getSessionsBase(): string {
  return join(homedir(), '.agent-desktop', 'sessions-folder')
}

/** Get the knowledges directory */
export function getKnowledgesDir(): string {
  return join(homedir(), '.agent-desktop', 'knowledges')
}
