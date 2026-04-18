/**
 * Portable environment enrichment for headless mode.
 * Resolves CLAUDE_CONFIG_DIR, HOME, PATH, DBUS_SESSION_BUS_ADDRESS.
 * No Electron dependencies.
 */

import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'

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

  // PATH enrichment — cron strips PATH down to /usr/bin:/bin. Toolchain
  // managers (mise, nvm, pyenv, cargo, nix) live elsewhere and MCP servers
  // launched by the SDK CLI need them. Strategy: spawn a login shell to
  // capture the user's real PATH; fall back to a hardcoded list if the shell
  // call fails (no shell, not interactive, etc.).
  const loginPath = readLoginShellPath()
  const currentPath = process.env.PATH || ''

  if (loginPath) {
    // Merge: login shell PATH first (priority), then anything cron passed in
    process.env.PATH = mergePathDedup(loginPath, currentPath)
  } else {
    // Hardcoded fallback — covers most install layouts even without a shell
    const fallback = [
      '/usr/local/bin',
      '/usr/bin',
      join(homedir(), '.local/bin'),
      join(homedir(), '.local/share/mise/shims'),
      join(homedir(), '.cargo/bin'),
      join(homedir(), '.nix-profile/bin'),
      join(homedir(), '.pyenv/shims'),
    ]
    process.env.PATH = mergePathDedup(fallback.join(':'), currentPath)
  }
}

function readLoginShellPath(): string | null {
  try {
    const shell = resolveUserShell()
    const out = execSync(`${shell} -lc 'printf %s "$PATH"'`, {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function resolveUserShell(): string {
  if (process.env.SHELL && existsSync(process.env.SHELL)) return process.env.SHELL
  try {
    const uid = process.getuid?.()
    if (uid !== undefined) {
      const passwd = readFileSync('/etc/passwd', 'utf-8')
      const line = passwd.split('\n').find(l => l.split(':')[2] === String(uid))
      const shell = line?.split(':')[6]?.trim()
      if (shell && existsSync(shell)) return shell
    }
  } catch { /* fall through */ }
  return '/bin/sh'
}

function mergePathDedup(primary: string, secondary: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of [...primary.split(':'), ...secondary.split(':')]) {
    if (p && !seen.has(p)) { seen.add(p); out.push(p) }
  }
  return out.join(':')
}

/** Get the sessions base directory (where task CWDs live) */
export function getSessionsBase(): string {
  return join(homedir(), '.agent-desktop', 'sessions-folder')
}

/** Get the knowledges directory */
export function getKnowledgesDir(): string {
  return join(homedir(), '.agent-desktop', 'knowledges')
}
