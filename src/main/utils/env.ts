import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { execFileSync, spawnSync } from 'child_process'
import { sanitizeAppImageEnv } from './env/sanitizeAppImage'
import { sanitizeWaylandEnv } from './env/sanitizeWayland'
import { loadShellEnv } from './env/loadShellEnv'

// Re-export from core — canonical source is now src/core/utils/env.ts
export { findBinaryInPath } from '../../core/utils/env'

/** Check if running inside an AppImage */
export function isAppImage(): boolean {
  return !!process.env.APPIMAGE
}

/** Detect whether the current session is Wayland, X11, or unknown. */
export function getSessionType(): 'wayland' | 'x11' | 'unknown' {
  if (process.env.XDG_SESSION_TYPE === 'wayland') return 'wayland'
  // WAYLAND_DISPLAY being set means Wayland is active, even if DISPLAY is
  // also set (XWayland). Hyprland/Sway/KDE all set both.
  if (process.env.WAYLAND_DISPLAY) return 'wayland'
  // Hyprland compositor detected (via env or enrichEnvironment() scan) —
  // treat as Wayland even if WAYLAND_DISPLAY wasn't inherited (TTY-started sessions)
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return 'wayland'
  if (process.env.XDG_SESSION_TYPE === 'x11') return 'x11'
  if (process.env.DISPLAY) return 'x11'
  return 'unknown'
}

/**
 * Inject the macOS OAuth token from Keychain into process.env so the Claude
 * Code CLI subprocess can authenticate without doing its own Keychain lookup.
 * When launched from Finder/Dock, CLAUDE_CODE_OAUTH_TOKEN is not inherited
 * from the shell — the CLI falls back to Keychain access which fails there.
 * No-op on non-Darwin or when the env var is already set.
 */
function injectMacOSKeychainToken(): void {
  if (process.platform !== 'darwin') return
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return

  try {
    const username = process.env.USER || os.userInfo().username
    const credJson = execFileSync('security', [
      'find-generic-password', '-a', username, '-s', 'Claude Code-credentials', '-w'
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
    const creds = JSON.parse(credJson)
    const accessToken = creds?.claudeAiOauth?.accessToken
    if (accessToken) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = accessToken
      console.log('[env] Set CLAUDE_CODE_OAUTH_TOKEN from macOS Keychain')
    }
  } catch {
    // Keychain not accessible or no credentials — will be caught at auth check
  }
}

/**
 * Enrich process.env for AppImage and non-standard environments.
 * Additive only — never overwrites existing values.
 * Call once at startup, before app.whenReady().
 *
 * Delegates to focused helpers in ./env/:
 * - loadShellEnv: PATH discovery (system bins, nvm, Homebrew)
 * - sanitizeWaylandEnv: D-Bus / Wayland / Hyprland env vars
 * - sanitizeAppImageEnv: strip AppImage-injected LD_LIBRARY_PATH / LD_PRELOAD
 */
export function enrichEnvironment(): void {
  const home = os.homedir()

  // Ensure HOME is set (some AppImage environments strip it)
  if (!process.env.HOME) {
    process.env.HOME = home
    console.log('[env] Set HOME =', home)
  }

  // Ensure CLAUDE_CONFIG_DIR is set so the SDK finds credentials
  if (!process.env.CLAUDE_CONFIG_DIR) {
    process.env.CLAUDE_CONFIG_DIR = path.join(home, '.claude')
    console.log('[env] Set CLAUDE_CONFIG_DIR =', process.env.CLAUDE_CONFIG_DIR)
  }

  sanitizeWaylandEnv()
  loadShellEnv()
  injectMacOSKeychainToken()

  // AppImage cleanup: remove bundled library paths so child processes
  // (claude CLI, whisper, etc.) don't load incompatible Electron .so files.
  if (isAppImage()) {
    console.log('[env] Running inside AppImage:', process.env.APPIMAGE)
    sanitizeAppImageEnv()
  }
}

/**
 * Read OAuth config from the installed Claude Agent SDK CLI bundle.
 * The client ID, token URL and scopes are defined in cli.js — reading them at
 * runtime means we stay in sync if the SDK is updated, instead of hardcoding.
 * Falls back to the values that were current when this was written.
 */
async function readCliOAuthConfig(): Promise<{ tokenUrl: string; clientId: string }> {
  try {
    // cli.js is a bundled JS file next to sdk.mjs in the package
    const cliPath = require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    const content = await fs.promises.readFile(cliPath, 'utf8')
    // Matches: TOKEN_URL:"https://platform.claude.com/v1/oauth/token"
    const tokenUrl = content.match(/TOKEN_URL:"(https:\/\/[^"]+\/v1\/oauth\/token)"/)?.[1]
    // Matches: CLIENT_ID:"9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    const clientId = content.match(/CLIENT_ID:"([0-9a-f-]{36})"/)?.[1]
    // Also respect the env var override the CLI itself uses
    return {
      tokenUrl: tokenUrl ?? 'https://platform.claude.com/v1/oauth/token',
      clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ?? clientId ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    }
  } catch {
    return {
      tokenUrl: 'https://platform.claude.com/v1/oauth/token',
      clientId: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    }
  }
}

/**
 * Ensure process.env.CLAUDE_CODE_OAUTH_TOKEN is set and not expired.
 * If the token is expired, attempts a refresh_token grant against Claude's OAuth endpoint.
 * Updates the macOS Keychain with the refreshed credentials on success.
 * No-op on non-Darwin platforms.
 */
export async function ensureFreshMacOSToken(): Promise<void> {
  if (process.platform !== 'darwin') return

  try {
    const username = process.env.USER || os.userInfo().username
    const credJson = execFileSync('security', [
      'find-generic-password', '-a', username, '-s', 'Claude Code-credentials', '-w'
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()

    const creds = JSON.parse(credJson)
    const oauth = creds?.claudeAiOauth
    if (!oauth?.accessToken) return

    const expiresAt: number = oauth.expiresAt ?? 0
    const isExpired = expiresAt > 0 && Date.now() > expiresAt

    if (!isExpired) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = oauth.accessToken
      return
    }

    const refreshToken: string | undefined = oauth.refreshToken
    if (!refreshToken) {
      console.error('[env] OAuth token expired and no refresh token available')
      return
    }

    console.log('[env] OAuth token expired, refreshing...')
    const { tokenUrl, clientId } = await readCliOAuthConfig()
    // Use the scopes from the stored credentials (exact scopes originally granted)
    const scopes = Array.isArray(oauth.scopes) ? oauth.scopes.join(' ') : ''
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        ...(scopes && { scope: scopes }),
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[env] Token refresh failed: ${res.status} ${body.slice(0, 200)}`)
      throw new Error(
        'Claude session expired. Run `claude login` in your terminal to re-authenticate, then try again.'
      )
    }

    const tokens = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!tokens.access_token) {
      console.error('[env] Token refresh response missing access_token')
      return
    }

    const newExpiresAt = Date.now() + ((tokens.expires_in ?? 3600) * 1000)
    const updatedCreds = {
      ...creds,
      claudeAiOauth: {
        ...oauth,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? refreshToken,
        expiresAt: newExpiresAt,
      },
    }

    // Write refreshed credentials back to Keychain
    spawnSync(
      'security',
      ['add-generic-password', '-a', username, '-s', 'Claude Code-credentials', '-w', JSON.stringify(updatedCreds), '-U'],
      { stdio: 'ignore' }
    )

    process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token
    console.log('[env] CLAUDE_CODE_OAUTH_TOKEN refreshed successfully')
  } catch (err) {
    // Re-throw auth errors (session expired, invalid_grant) so they surface in the UI.
    // Only swallow unexpected failures (network, JSON parsing, Keychain read).
    if (err instanceof Error && err.message.includes('claude login')) {
      throw err
    }
    console.error('[env] ensureFreshMacOSToken unexpected error:', err)
  }
}
