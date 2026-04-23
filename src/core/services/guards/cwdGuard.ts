import { resolve, normalize, sep } from 'path'
import { expandTilde } from '../../utils/paths'
import type { CwdWhitelistEntry } from '../../types'

/**
 * Checks whether a file path resolves outside the given CWD.
 * Returns the resolved absolute path if outside, null if inside.
 * Expands ~ to home directory before resolving.
 */
export function isPathOutsideCwd(filePath: string, cwd: string): string | null {
  const expanded = expandTilde(filePath)
  let normalizedCwd = normalize(cwd)
  // Strip trailing separator (normalize preserves it on POSIX)
  if (normalizedCwd.endsWith(sep) && normalizedCwd !== sep) {
    normalizedCwd = normalizedCwd.slice(0, -1)
  }
  const resolved = normalize(resolve(cwd, expanded))

  if (resolved === normalizedCwd) return null
  if (resolved.startsWith(normalizedCwd + sep)) return null

  return resolved
}

/**
 * Checks whether a file path is outside the CWD AND all additional writable paths.
 * Returns the resolved absolute path if outside all allowed dirs, null if inside any.
 */
export function isPathOutsideAllowed(filePath: string, cwd: string, additionalPaths?: string[]): string | null {
  // First check CWD
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null  // inside CWD, allow

  // Check additional writable paths
  if (additionalPaths) {
    for (const allowed of additionalPaths) {
      const outsideAllowed = isPathOutsideCwd(filePath, allowed)
      if (!outsideAllowed) return null  // inside an additional allowed path
    }
  }

  return outsideCwd  // outside all allowed paths
}

/**
 * Checks whether a file path is outside CWD and all whitelist entries (both read and readwrite).
 * Returns null if inside any allowed read dir, resolved path if outside all.
 */
export function isPathOutsideReadAllowed(filePath: string, cwd: string, whitelist: CwdWhitelistEntry[]): string | null {
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null

  for (const entry of whitelist) {
    const outside = isPathOutsideCwd(filePath, entry.path)
    if (!outside) return null
  }

  return outsideCwd
}

/**
 * Checks whether a file path is outside CWD and all readwrite whitelist entries.
 * Read-only entries do NOT grant write access.
 * Returns null if inside any writable dir, resolved path if outside all.
 */
export function isPathOutsideWriteAllowed(filePath: string, cwd: string, whitelist: CwdWhitelistEntry[]): string | null {
  const outsideCwd = isPathOutsideCwd(filePath, cwd)
  if (!outsideCwd) return null

  for (const entry of whitelist) {
    if (entry.access === 'readwrite') {
      const outside = isPathOutsideCwd(filePath, entry.path)
      if (!outside) return null
    }
  }

  return outsideCwd
}

/**
 * Best-effort extraction of write-target paths from a Bash command.
 * Detects redirections (>, >>), and common write commands (tee, cp, mv, etc.).
 */
export function extractBashWritePaths(command: string): string[] {
  const paths = new Set<string>()

  // Redirections: > file, >> file
  const redirectRegex = />{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
  let match: RegExpExecArray | null
  while ((match = redirectRegex.exec(command)) !== null) {
    const p = match[1] || match[2] || match[3]
    if (p) paths.add(p)
  }

  // tee: output goes to listed files
  const teeRegex = /\btee\s+(?:-[a-z]\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/g
  while ((match = teeRegex.exec(command)) !== null) {
    const p = match[1] || match[2] || match[3]
    if (p && !p.startsWith('-')) paths.add(p)
  }

  // cp/install: last argument is destination
  const cpRegex = /\b(?:cp|install)\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = cpRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // mv: last argument is destination
  const mvRegex = /\bmv\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = mvRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // mkdir: all non-flag arguments
  const mkdirRegex = /\bmkdir\s+(.+?)(?:[;&|]|$)/g
  while ((match = mkdirRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // touch: all non-flag arguments
  const touchRegex = /\btouch\s+(.+?)(?:[;&|]|$)/g
  while ((match = touchRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // ln: last argument is destination
  const lnRegex = /\bln\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = lnRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  // rsync: last argument is destination
  const rsyncRegex = /\brsync\s+(?:-[a-zA-Z]+\s+)*(.+)/g
  while ((match = rsyncRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    if (args.length >= 2) paths.add(args[args.length - 1])
  }

  return Array.from(paths)
}

/**
 * Best-effort extraction of read-target paths from a Bash command.
 * Detects common read commands: cat, head, tail, less, find, ls, tree, file, stat, wc, diff, strings, xxd.
 */
export function extractBashReadPaths(command: string): string[] {
  const paths = new Set<string>()

  // Single-target read commands: extract all non-flag arguments
  const singleTargetCmds = ['cat', 'head', 'tail', 'less', 'file', 'stat', 'wc', 'strings', 'xxd']
  for (const cmd of singleTargetCmds) {
    const regex = new RegExp(`\\b${cmd}\\s+(.+?)(?:[;&|]|$)`, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(command)) !== null) {
      const args = splitShellArgs(match[1])
      for (const arg of args) {
        if (!arg.startsWith('-')) paths.add(arg)
      }
    }
  }

  // find: first non-flag argument is the search path
  const findRegex = /\bfind\s+(.+?)(?:[;&|]|$)/g
  let match: RegExpExecArray | null
  while ((match = findRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) {
        paths.add(arg)
        break  // find's first non-flag arg is the path
      }
    }
  }

  // ls: all non-flag arguments
  const lsRegex = /\bls\s+(.+?)(?:[;&|]|$)/g
  while ((match = lsRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // tree: all non-flag arguments
  const treeRegex = /\btree\s+(.+?)(?:[;&|]|$)/g
  while ((match = treeRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  // diff: both non-flag arguments are paths
  const diffRegex = /\bdiff\s+(.+?)(?:[;&|]|$)/g
  while ((match = diffRegex.exec(command)) !== null) {
    const args = splitShellArgs(match[1])
    for (const arg of args) {
      if (!arg.startsWith('-')) paths.add(arg)
    }
  }

  return Array.from(paths)
}

/** Naive shell arg splitter — handles simple quoting */
function splitShellArgs(s: string): string[] {
  const args: string[] = []
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(s)) !== null) {
    const val = m[1] || m[2] || m[3]
    // Stop at shell operators
    if (val === '|' || val === ';' || val === '&&' || val === '||') break
    if (val) args.push(val)
  }
  return args
}
