import * as path from 'path'
import * as fs from 'fs'

/**
 * Find a binary by name in PATH using pure Node.js (no `which` spawn).
 * Returns the absolute path if found and executable, null otherwise.
 */
export function findBinaryInPath(name: string): string | null {
  if (path.isAbsolute(name)) {
    try {
      fs.accessSync(name, fs.constants.X_OK)
      return name
    } catch {
      return null
    }
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of pathDirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // not here, try next
    }
  }
  return null
}
