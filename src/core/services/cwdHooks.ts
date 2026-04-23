import type { CwdWhitelistEntry } from '../types'
import {
  isPathOutsideCwd,
  isPathOutsideAllowed,
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  extractBashWritePaths,
  extractBashReadPaths,
} from './guards/cwdGuard'

export {
  isPathOutsideCwd,
  isPathOutsideAllowed,
  isPathOutsideReadAllowed,
  isPathOutsideWriteAllowed,
  extractBashWritePaths,
  extractBashReadPaths,
}

// ─── SDK Hook Types ──────────────────────────────────────────

/** Input object passed to PreToolUse hook callbacks by the Agent SDK */
interface PreToolUseHookInput {
  hook_event_name: string
  tool_name: string
  tool_input: Record<string, unknown>
  session_id: string
  cwd: string
  [key: string]: unknown
}

interface HookResult {
  hookSpecificOutput?: {
    hookEventName: string
    permissionDecision: 'allow' | 'deny' | 'ask'
    permissionDecisionReason: string
  }
}

/** SDK HookCallback signature: (input, toolUseID, context) */
type HookCallback = (
  input: PreToolUseHookInput,
  toolUseId: string | null,
  context: { signal: AbortSignal }
) => Promise<HookResult>

/** Normalize legacy string[] to CwdWhitelistEntry[] (all readwrite) */
function normalizeWhitelist(input?: CwdWhitelistEntry[] | string[]): CwdWhitelistEntry[] | undefined {
  if (!input || input.length === 0) return undefined
  if (typeof input[0] === 'string') {
    return (input as string[]).map(p => ({ path: p, access: 'readwrite' as const }))
  }
  return input as CwdWhitelistEntry[]
}

/**
 * Builds SDK-compatible hooks for CWD restriction.
 * Uses the correct Agent SDK hooks API:
 *   hooks: { PreToolUse: [{ matcher: '...', hooks: [callback] }] }
 *
 * The callback follows the SDK signature: (input, toolUseID, { signal })
 * and returns { hookSpecificOutput: { hookEventName, permissionDecision, ... } }
 *
 * When whitelist is provided, read tools (Read, Glob, Grep) are also checked
 * and Bash read commands are validated against read-allowed directories.
 *
 * Accepts either CwdWhitelistEntry[] or legacy string[] (treated as readwrite).
 */
export function buildCwdRestrictionHooks(cwd: string, whitelistOrPaths?: CwdWhitelistEntry[] | string[]) {
  const whitelist = normalizeWhitelist(whitelistOrPaths)
  const hasWhitelist = whitelist && whitelist.length > 0

  const cwdRestrictionHook: HookCallback = async (input, _toolUseId, _context) => {
    const toolName = input.tool_name
    const toolInput = input.tool_input

    // Read tool: check file_path (only when whitelist is non-empty)
    if (toolName === 'Read' && hasWhitelist) {
      const filePath = toolInput.file_path as string | undefined
      if (filePath) {
        const outside = isPathOutsideReadAllowed(filePath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Glob: check path (only when whitelist is non-empty)
    if (toolName === 'Glob' && hasWhitelist) {
      const globPath = toolInput.path as string | undefined
      if (globPath) {
        const outside = isPathOutsideReadAllowed(globPath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Grep: check path (only when whitelist is non-empty)
    if (toolName === 'Grep' && hasWhitelist) {
      const grepPath = toolInput.path as string | undefined
      if (grepPath) {
        const outside = isPathOutsideReadAllowed(grepPath, cwd, whitelist)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, whitelist)
        }
      }
      return {}
    }

    // Write / Edit: check file_path
    if (toolName === 'Write' || toolName === 'Edit') {
      const filePath = toolInput.file_path as string | undefined
      if (filePath) {
        const outside = hasWhitelist
          ? isPathOutsideWriteAllowed(filePath, cwd, whitelist)
          : isPathOutsideAllowed(filePath, cwd)
        if (outside) {
          return makeDenyResult(input.hook_event_name, toolName, outside, cwd, hasWhitelist ? whitelist : undefined)
        }
      }
      return {}
    }

    // NotebookEdit: check notebook_path
    if (toolName === 'NotebookEdit') {
      const nbPath = toolInput.notebook_path as string | undefined
      if (nbPath) {
        const outside = hasWhitelist
          ? isPathOutsideWriteAllowed(nbPath, cwd, whitelist)
          : isPathOutsideAllowed(nbPath, cwd)
        if (outside) {
          return makeDenyResult(input.hook_event_name, 'NotebookEdit', outside, cwd, hasWhitelist ? whitelist : undefined)
        }
      }
      return {}
    }

    // Bash: best-effort parse for write targets + read targets (when whitelist exists)
    if (toolName === 'Bash') {
      const command = toolInput.command as string | undefined
      if (command) {
        // Check write paths
        const writePaths = extractBashWritePaths(command)
        for (const p of writePaths) {
          const outside = hasWhitelist
            ? isPathOutsideWriteAllowed(p, cwd, whitelist)
            : isPathOutsideAllowed(p, cwd)
          if (outside) {
            return makeDenyResult(input.hook_event_name, 'Bash', outside, cwd, hasWhitelist ? whitelist : undefined)
          }
        }

        // Check read paths (only when whitelist is non-empty)
        if (hasWhitelist) {
          const readPaths = extractBashReadPaths(command)
          for (const p of readPaths) {
            const outside = isPathOutsideReadAllowed(p, cwd, whitelist)
            if (outside) {
              return makeDenyResult(input.hook_event_name, 'Bash', outside, cwd, whitelist)
            }
          }
        }
      }
      return {}
    }

    // Unknown tools: allow
    return {}
  }

  const matcher = hasWhitelist
    ? 'Write|Edit|NotebookEdit|Bash|Read|Glob|Grep'
    : 'Write|Edit|NotebookEdit|Bash'

  return {
    PreToolUse: [
      { matcher, hooks: [cwdRestrictionHook] },
    ],
  }
}

function makeDenyResult(
  hookEventName: string,
  toolName: string,
  resolvedPath: string,
  cwd: string,
  whitelist?: CwdWhitelistEntry[]
): HookResult {
  let allowedDirs: string
  if (whitelist && whitelist.length > 0) {
    const dirs = [`"${cwd}" (readwrite)`, ...whitelist.map(e => `"${e.path}" (${e.access})`)].join(', ')
    allowedDirs = dirs
  } else {
    allowedDirs = `"${cwd}"`
  }
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: 'deny',
      permissionDecisionReason: `${toolName} targets "${resolvedPath}" which is outside the allowed directories (${allowedDirs}). Write operations are restricted.`,
    },
  }
}
