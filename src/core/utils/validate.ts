import * as path from 'path'

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
const BLOCKED_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']

export function validatePathSafe(filePath: string, allowedBase?: string): string {
  const resolved = path.resolve(filePath)

  for (const prefix of BLOCKED_PREFIXES) {
    const normalizedPrefix = path.normalize(prefix)
    if (
      resolved.startsWith(normalizedPrefix + path.sep) ||
      resolved === normalizedPrefix
    ) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
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
