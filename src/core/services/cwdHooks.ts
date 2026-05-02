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

/** Resolved per-build context shared by all helper checks. */
interface HookContext {
  cwd: string
  whitelist: CwdWhitelistEntry[] | undefined
  hasWhitelist: boolean
}

/** Normalize legacy string[] to CwdWhitelistEntry[] (all readwrite) */
function normalizeWhitelist(input?: CwdWhitelistEntry[] | string[]): CwdWhitelistEntry[] | undefined {
  if (!input || input.length === 0) return undefined
  if (typeof input[0] === 'string') {
    return (input as string[]).map(p => ({ path: p, access: 'readwrite' as const }))
  }
  return input as CwdWhitelistEntry[]
}

// ─── Tool-category helpers ───────────────────────────────────

/**
 * Validate a read-only tool path (Read/Glob/Grep) against the whitelist.
 * Returns null when the call is allowed, or a HookResult deny otherwise.
 *
 * Read restrictions only apply when whitelist is non-empty (CLAUDE.md gotcha:
 * empty whitelist = backward compat, reads unrestricted).
 */
function checkReadTool(
  hookEventName: string,
  toolName: string,
  filePath: string | undefined,
  ctx: HookContext
): HookResult | null {
  if (!ctx.hasWhitelist || !filePath) return null
  const outside = isPathOutsideReadAllowed(filePath, ctx.cwd, ctx.whitelist!)
  if (!outside) return null
  return makeDenyResult(hookEventName, toolName, outside, ctx.cwd, ctx.whitelist)
}

/**
 * Validate a write tool path (Write/Edit/NotebookEdit) against the whitelist
 * (or against CWD if no whitelist set). Returns null when allowed.
 */
function checkWriteTool(
  hookEventName: string,
  toolName: string,
  filePath: string | undefined,
  ctx: HookContext
): HookResult | null {
  if (!filePath) return null
  const outside = ctx.hasWhitelist
    ? isPathOutsideWriteAllowed(filePath, ctx.cwd, ctx.whitelist!)
    : isPathOutsideAllowed(filePath, ctx.cwd)
  if (!outside) return null
  return makeDenyResult(hookEventName, toolName, outside, ctx.cwd, ctx.hasWhitelist ? ctx.whitelist : undefined)
}

/**
 * Validate a Bash command. Walks the parsed write paths first (always checked),
 * then read paths (only when whitelist is set). Returns null when allowed.
 */
function checkBashCommand(
  hookEventName: string,
  command: string | undefined,
  ctx: HookContext
): HookResult | null {
  if (!command) return null

  for (const p of extractBashWritePaths(command)) {
    const outside = ctx.hasWhitelist
      ? isPathOutsideWriteAllowed(p, ctx.cwd, ctx.whitelist!)
      : isPathOutsideAllowed(p, ctx.cwd)
    if (outside) {
      return makeDenyResult(hookEventName, 'Bash', outside, ctx.cwd, ctx.hasWhitelist ? ctx.whitelist : undefined)
    }
  }

  if (ctx.hasWhitelist) {
    for (const p of extractBashReadPaths(command)) {
      const outside = isPathOutsideReadAllowed(p, ctx.cwd, ctx.whitelist!)
      if (outside) {
        return makeDenyResult(hookEventName, 'Bash', outside, ctx.cwd, ctx.whitelist)
      }
    }
  }

  return null
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
  const ctx: HookContext = { cwd, whitelist, hasWhitelist: !!(whitelist && whitelist.length > 0) }

  const cwdRestrictionHook: HookCallback = async (input, _toolUseId, _context) => {
    const tool = input.tool_name
    const event = input.hook_event_name
    const ti = input.tool_input

    if (tool === 'Read') return checkReadTool(event, tool, ti.file_path as string | undefined, ctx) ?? {}
    if (tool === 'Glob') return checkReadTool(event, tool, ti.path as string | undefined, ctx) ?? {}
    if (tool === 'Grep') return checkReadTool(event, tool, ti.path as string | undefined, ctx) ?? {}
    if (tool === 'Write' || tool === 'Edit') return checkWriteTool(event, tool, ti.file_path as string | undefined, ctx) ?? {}
    if (tool === 'NotebookEdit') return checkWriteTool(event, 'NotebookEdit', ti.notebook_path as string | undefined, ctx) ?? {}
    if (tool === 'Bash') return checkBashCommand(event, ti.command as string | undefined, ctx) ?? {}
    return {}
  }

  const matcher = ctx.hasWhitelist
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
