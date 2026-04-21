export type PermissionMode = 'bypassPermissions' | 'acceptEdits' | 'default' | 'dontAsk' | 'plan'
export type PermissionDecision = 'allow' | 'deny' | 'ask'

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'Bash'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'])

/**
 * Pure policy — given a tool name, the current permission mode, and the tool input,
 * returns whether the tool should be auto-allowed, denied, or ask the user.
 *
 * Used by both Claude's canUseTool adapter (Phase 2) and the PI extension's
 * permissionModes module. Caching of "ask" decisions (for dontAsk mode) is
 * the caller's responsibility.
 */
export function shouldRequireApproval(
  toolName: string,
  mode: PermissionMode,
  _toolInput: Record<string, unknown>,
): PermissionDecision {
  if (mode === 'bypassPermissions') return 'allow'

  if (mode === 'plan') {
    if (READ_TOOLS.has(toolName)) return 'allow'
    if (MUTATING_TOOLS.has(toolName)) return 'deny'
    return 'deny'
  }

  if (READ_TOOLS.has(toolName)) return 'allow'

  if (mode === 'acceptEdits') {
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') return 'allow'
    if (MUTATING_TOOLS.has(toolName)) return 'ask'
    return 'allow'
  }

  // default and dontAsk (cache handled by caller)
  if (MUTATING_TOOLS.has(toolName)) return 'ask'

  return 'ask'
}
