import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { shouldRequireApproval, type PermissionMode } from '../../../../core/services/guards/permissionPolicy'
import { createHash } from 'node:crypto'
import { Type } from '@sinclair/typebox'

const VALID_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan'] as const

const PLAN_READONLY_TOOLS = ['read', 'grep', 'find', 'ls']
const DEFAULT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']

function hashInput(input: unknown): string {
  return createHash('sha1').update(JSON.stringify(input ?? null)).digest('hex').slice(0, 16)
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
 * Tool names are lowercase (PI convention); `shouldRequireApproval` handles
 * case normalization internally so the same policy works for Claude too.
 */
export function initPermissionModes(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const modeRaw = ctx.aiSettings.permissionMode ?? 'bypassPermissions'
  const mode: PermissionMode = (VALID_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PermissionMode)
    : 'bypassPermissions'

  // bypassPermissions: no tool_call handler — default PI behavior allows everything.
  if (mode === 'bypassPermissions') return

  // Plan mode: lock to read-only tools and register exit_plan_mode.
  if (mode === 'plan') {
    pi.setActiveTools(PLAN_READONLY_TOOLS)

    const requireApproval = ctx.aiSettings.requirePlanApproval !== false

    pi.registerTool({
      name: 'exit_plan_mode',
      label: 'Exit Plan Mode',
      description: 'Exit plan-only mode and allow mutating tools (write, edit, bash). Call this when the user approves the plan and wants changes to be applied.',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, _signal, _onUpdate, extCtx) => {
        if (requireApproval) {
          const ui = (extCtx as { ui: { confirm: (title: string, message: string) => Promise<boolean> } }).ui
          const ok = await ui.confirm('Exit Plan Mode?', 'Agent will start making changes to the workspace.')
          if (!ok) {
            return { content: [{ type: 'text', text: 'Plan-mode exit denied by user. Staying in plan-only mode.' }] }
          }
        }
        pi.setActiveTools(DEFAULT_TOOLS)
        ctx.bridge.emitSystemMessage(
          'Plan mode exited — mutating tools restored.',
          { hookName: 'permission-modes', hookEvent: 'PreToolUse' },
        )
        return { content: [{ type: 'text', text: 'Plan mode exited. Mutating tools are now available.' }] }
      },
    })
  }

  // Approval cache for dontAsk mode. Key = `${toolName}:${hashInput}`.
  const approvalCache = new Map<string, boolean>()

  pi.on('tool_call', async (event, extCtx) => {
    const decision = shouldRequireApproval(event.toolName, mode)
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
    const cacheKey = `${event.toolName}:${hashInput(event.input)}`
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
}
