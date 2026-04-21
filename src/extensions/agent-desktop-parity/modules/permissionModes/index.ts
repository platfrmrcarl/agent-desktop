import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { shouldRequireApproval, type PermissionMode } from '../../../../core/services/guards/permissionPolicy'
import { createHash } from 'node:crypto'

const VALID_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan'] as const

function hashInput(input: unknown): string {
  return createHash('sha1').update(JSON.stringify(input ?? null)).digest('hex').slice(0, 16)
}

/**
 * Normalize PI tool names (lowercase) to title-case for permissionPolicy lookup.
 * PI emits lowercase names ("write", "bash", "read") while the policy sets use
 * title-case ("Write", "Bash", "Read"). First-letter capitalize is sufficient
 * for all single-word built-in tools. Multi-word tools (NotebookEdit) must be
 * emitted by PI in their exact title-case form.
 */
function normalizeTool(toolName: string): string {
  return toolName.charAt(0).toUpperCase() + toolName.slice(1)
}

/**
 * Phase 2 — Permission modes.
 *
 * Implements the five Claude-SDK modes on top of PI:
 * - bypassPermissions: allow all (no handler side-effect)
 * - acceptEdits: auto-allow write/edit, ask for bash
 * - default: ask for write/edit/bash
 * - dontAsk: like default, caches (toolName, hashInput) decisions
 * - plan: read-only lockdown + exit_plan_mode tool (Task 2)
 *
 * Approval prompts use `extCtx.ui.confirm` (native PI) which routes through our
 * `PiUIContext` adapter to the Electron renderer. No new stream protocol.
 *
 * Note: PI emits lowercase tool names; permissionPolicy uses title-case sets.
 * normalizeTool() bridges the gap at this module boundary.
 */
export function initPermissionModes(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const modeRaw = ctx.aiSettings.permissionMode ?? 'bypassPermissions'
  const mode: PermissionMode = (VALID_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PermissionMode)
    : 'bypassPermissions'

  // bypassPermissions: no tool_call handler — default PI behavior allows everything.
  if (mode === 'bypassPermissions') return

  // Approval cache for dontAsk mode. Key = `${toolName}:${hashInput}`.
  const approvalCache = new Map<string, boolean>()

  pi.on('tool_call', async (event, extCtx) => {
    const normalized = normalizeTool(event.toolName)
    const decision = shouldRequireApproval(normalized, mode)
    if (decision === 'allow') return undefined
    if (decision === 'deny') {
      const reason = `Tool "${event.toolName}" is not allowed in ${mode} mode`
      ctx.bridge.emitSystemMessage(
        `Tool blocked by permission-modes: ${reason}`,
        { hookName: 'permission-modes', hookEvent: 'PreToolUse' },
      )
      return { block: true, reason }
    }

    // decision === 'ask' — check cache for dontAsk first.
    const cacheKey = `${normalized}:${hashInput(event.input)}`
    if (mode === 'dontAsk' && approvalCache.has(cacheKey)) {
      return approvalCache.get(cacheKey)
        ? undefined
        : { block: true, reason: 'Previously denied (dontAsk cache)' }
    }

    const ui = (extCtx as { ui: { confirm: (title: string, message: string) => Promise<boolean> } }).ui
    const title = `Allow ${event.toolName}?`
    const message = `Permission mode: ${mode}\nTool input: ${JSON.stringify(event.input).slice(0, 400)}`
    const allowed = await ui.confirm(title, message)

    if (mode === 'dontAsk') approvalCache.set(cacheKey, allowed)
    if (allowed) return undefined
    const reason = `User denied ${event.toolName}`
    ctx.bridge.emitSystemMessage(
      `Tool blocked by permission-modes: ${reason}`,
      { hookName: 'permission-modes', hookEvent: 'PreToolUse' },
    )
    return { block: true, reason }
  })

  // Plan mode handling lands in Task 2 — same factory, additive.
}
