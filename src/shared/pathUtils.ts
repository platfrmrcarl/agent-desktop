/**
 * Cross-platform path utilities.
 * Work in both Node.js (main process) and browser (renderer) contexts.
 * Handle both forward slashes and backslashes.
 */

export function isChildPath(parent: string, child: string): boolean {
  const p = parent.replace(/\\/g, '/')
  const c = child.replace(/\\/g, '/')
  return c.startsWith(p + '/')
}

export function pathDirname(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep <= 0 ? '/' : filePath.slice(0, lastSep)
}

export function pathBasename(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep === -1 ? filePath : filePath.slice(lastSep + 1)
}
