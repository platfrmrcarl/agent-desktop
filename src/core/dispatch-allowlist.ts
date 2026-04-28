/**
 * Dispatch origin + channel allowlist.
 *
 * Every invocation through the DispatchRegistry carries an `origin` tag
 * identifying where the call came from. Sensitive channels refuse
 * non-`electron` origins; a narrower block-list blocks specific channels
 * from reaching the WebSocket bridge at all.
 *
 * This is the canonical source of truth for the WS-reachable attack
 * surface. New handlers are opt-in: the default policy is "reachable from
 * every origin." Add entries here when a handler drives spawn, fs, git, or
 * destructive DB work.
 */

export type DispatchOrigin = 'electron' | 'ws' | 'discord' | 'scheduler'

/**
 * Channels that MUST only be invoked from the Electron main process (i.e.
 * from a trusted renderer via ipcMain). Remote WS/Discord/scheduler
 * invocations are refused.
 *
 * Selection criteria (from 2026-04-23 security audit):
 *  - Drives subprocess spawn with attacker-controlled argv
 *  - Touches the filesystem outside the conversation CWD
 *  - Executes destructive DB operations without user confirmation
 *  - Invokes git with attacker-controlled positional arguments
 */
export const ELECTRON_ONLY_CHANNELS: ReadonlySet<string> = new Set([
  // MCP server management — arbitrary command+args, turn-key RCE via testConnection
  'mcp:addServer',
  'mcp:updateServer',
  'mcp:testConnection',
  // Destructive DB wipes — no server-side confirmation
  'system:purgeAll',
  'system:purgeConversations',
  // Terminal + session prep — spawns processes and copies filesystem trees
  'files:openTerminalHere',
  'files:prepareSession',
  // Git positional-argument injection (--upload-pack=, etc.)
  'git:fetch',
  'git:checkout',
])

/**
 * Channels that the WebSocket bridge MUST never forward, regardless of
 * the authenticated-client state. These are control-plane operations
 * that a remote client has no legitimate reason to invoke on the host.
 *
 *  - server:{start,stop,getStatus} — remote clients must not manage the
 *    server they are connected through.
 *  - server:{setPassword,clearPassword} — LAN attacker must not rotate the
 *    session secret and lock out the legitimate user.
 *  - settings:set — persists arbitrary key/value to global settings; a
 *    remote client could overwrite security-sensitive config (e.g. bypass
 *    permissions, MCP servers) without local user interaction.
 *  - openscad:exportStl — uses `event.sender` (null over WS → crash).
 */
export const WS_BLOCKED_CHANNELS: ReadonlySet<string> = new Set([
  'openscad:exportStl',
  'server:clearPassword',  // credential control-plane: remote must not clear the password
  'server:getStatus',
  'server:setPassword',    // credential control-plane: remote must not rotate the session secret
  'server:start',
  'server:stop',
  'settings:set',          // security-sensitive config mutation must stay local
])

export class OriginDeniedError extends Error {
  readonly channel: string
  readonly origin: DispatchOrigin
  constructor(channel: string, origin: DispatchOrigin) {
    super(`Channel '${channel}' is not available from origin '${origin}'`)
    this.name = 'OriginDeniedError'
    this.channel = channel
    this.origin = origin
  }
}

export function isElectronOnly(channel: string): boolean {
  return ELECTRON_ONLY_CHANNELS.has(channel)
}

export function isWsBlocked(channel: string): boolean {
  return WS_BLOCKED_CHANNELS.has(channel)
}

/**
 * Throws OriginDeniedError if the (channel, origin) pair is forbidden.
 * Safe to call on every dispatch invocation — O(1) set lookups.
 */
export function assertOriginAllowed(channel: string, origin: DispatchOrigin): void {
  if (origin === 'ws' && WS_BLOCKED_CHANNELS.has(channel)) {
    throw new OriginDeniedError(channel, origin)
  }
  if (origin !== 'electron' && ELECTRON_ONLY_CHANNELS.has(channel)) {
    throw new OriginDeniedError(channel, origin)
  }
}
