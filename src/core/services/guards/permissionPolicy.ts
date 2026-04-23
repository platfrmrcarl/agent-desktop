export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'default' | 'dontAsk' | 'plan'
export type PermissionDecision = 'allow' | 'deny' | 'ask'

// Tool sets keyed by lowercase canonical names. PI emits lowercase
// ("write", "bash", "ls"); Claude emits title-case ("Write", "Bash", "LS").
// We lowercase at the function boundary so both callers work transparently.
const MUTATING_TOOLS = new Set(['write', 'edit', 'notebookedit', 'bash'])
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'ls', 'find', 'webfetch', 'websearch'])

/**
 * Pure policy — given a tool name and the current permission mode, returns
 * whether the tool should be auto-allowed, denied, or ask the user.
 *
 * Accepts both lowercase (PI convention) and title-case (Claude convention)
 * tool names. Caching of "ask" decisions (for dontAsk mode) is the
 * caller's responsibility.
 */
export function shouldRequireApproval(toolName: string, mode: PermissionMode): PermissionDecision {
  if (mode === 'bypassPermissions') return 'allow'

  const name = toolName.toLowerCase()

  if (mode === 'plan') {
    return READ_TOOLS.has(name) ? 'allow' : 'deny'
  }

  if (READ_TOOLS.has(name)) return 'allow'

  if (mode === 'acceptEdits') {
    if (name === 'write' || name === 'edit' || name === 'notebookedit') return 'allow'
    return MUTATING_TOOLS.has(name) ? 'ask' : 'allow'
  }

  // default and dontAsk (cache handled by caller)
  return 'ask'
}
