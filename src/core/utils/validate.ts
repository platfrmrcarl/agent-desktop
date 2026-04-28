import * as path from 'path'
import * as os from 'os'

export function validateString(value: unknown, name: string, maxLength = 10000): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
  if (value.length > maxLength) throw new Error(`${name} exceeds max length (${maxLength})`)
  return value
}

export function validatePositiveInt(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

// Unix-only system directories — harmless on Windows (paths never match)
const UNIX_BLOCKED_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']

/**
 * These paths are always denied regardless of hooks_cwdWhitelist — they hold
 * credentials that no agent or remote client should access.
 * Built lazily from os.homedir() and platform env vars so tests can override homedir.
 */
function buildCredentialBlocklist(): string[] {
  const home = os.homedir()
  const entries: string[] = [
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
    path.join(home, '.config', 'agent-desktop'),
  ]

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    const userProfile = process.env.USERPROFILE
    if (appData) {
      entries.push(path.join(appData, 'Microsoft', 'Credentials'))
    }
    if (userProfile) {
      entries.push(path.join(userProfile, '.ssh'))
      entries.push(path.join(userProfile, '.aws'))
    }
  }

  return entries
}

function isBlockedCredentialPath(resolved: string): boolean {
  for (const blocked of buildCredentialBlocklist()) {
    const normalized = path.normalize(blocked)
    if (resolved === normalized || resolved.startsWith(normalized + path.sep)) {
      return true
    }
  }
  return false
}

export function validatePathSafe(filePath: string, allowedBase?: string): string {
  const resolved = path.resolve(filePath)

  // Unix system directories
  for (const prefix of UNIX_BLOCKED_PREFIXES) {
    const normalizedPrefix = path.normalize(prefix)
    if (
      resolved.startsWith(normalizedPrefix + path.sep) ||
      resolved === normalizedPrefix
    ) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
  }

  // Credential and dotfile directories — always denied regardless of whitelist
  if (isBlockedCredentialPath(resolved)) {
    throw new Error(`Access denied: ${resolved} is a protected credential path`)
  }

  if (allowedBase) {
    const resolvedBase = path.resolve(allowedBase)
    const relativePath = path.relative(resolvedBase, resolved)
    if (
      relativePath &&
      (relativePath.startsWith('..') || path.isAbsolute(relativePath))
    ) {
      throw new Error(
        `Path traversal detected: ${resolved} is outside ${resolvedBase}`,
      )
    }
  }

  return resolved
}

/** Minimal CwdWhitelistEntry shape — mirrors core/types/types.ts to avoid cross-layer import */
interface WhitelistEntry {
  path: string
  access: 'read' | 'readwrite'
}

/**
 * Checks whether `resolved` (already resolved absolute path) is permitted by the
 * global hooks_cwdWhitelist. Returns null if permitted, or the resolved path if denied.
 *
 * Semantics mirror cwdGuard.isPathOutsideReadAllowed:
 *   - Only enforced when whitelist is non-empty (backward compat)
 *   - Both 'read' and 'readwrite' entries grant read access
 *   - Path must be under at least one whitelisted entry
 */
export function checkReadAllowed(resolved: string, whitelist: WhitelistEntry[]): string | null {
  if (whitelist.length === 0) return null  // no whitelist = allow all (backward compat)

  for (const entry of whitelist) {
    const base = path.resolve(entry.path)
    if (resolved === base || resolved.startsWith(base + path.sep)) {
      return null  // permitted
    }
  }

  return resolved  // outside all whitelist entries
}
