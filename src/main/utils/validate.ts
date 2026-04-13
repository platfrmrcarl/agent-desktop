import * as path from 'path'

// Re-export core validators (single source of truth)
export { validateString, validatePositiveInt } from '../../core/utils/validate'

// Blocked system directories that should never be read
const BLOCKED_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']

export function validatePathSafe(filePath: string, allowedBase?: string): string {
  const resolved = path.resolve(filePath)

  // Block system directories
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
  }

  // If an allowedBase is provided, ensure path stays within it
  if (allowedBase) {
    const resolvedBase = path.resolve(allowedBase)
    if (!resolved.startsWith(resolvedBase + '/') && resolved !== resolvedBase) {
      throw new Error(`Path traversal detected: ${resolved} is outside ${resolvedBase}`)
    }
  }

  return resolved
}
