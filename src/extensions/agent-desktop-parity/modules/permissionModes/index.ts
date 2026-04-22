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
  // DIAGNOSTIC — emit the raw received value so we can see exactly what
  // the cascade delivers to the extension, regardless of any downstream
  // mode-branch logic.
  ctx.bridge.emitSystemMessage(
    `[diag] permission-modes init: aiSettings.permissionMode = ${JSON.stringify(ctx.aiSettings.permissionMode)} (conversationId=${ctx.conversationId})`,
    { hookName: 'permission-modes', hookEvent: 'SessionStart' },
  )

  // Unknown mode → fail-SAFE to 'default' (ask before mutating), not
  // bypassPermissions. A typo in settings must not silently widen trust.
  const modeRaw = ctx.aiSettings.permissionMode ?? 'default'
  const mode: PermissionMode = (VALID_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PermissionMode)
    : 'default'

  // bypassPermissions: no tool_call handler — default PI behavior allows everything.
  if (mode === 'bypassPermissions') return

  // Plan mode: lock to read-only tools and register exit_plan_mode.
  if (mode === 'plan') {
    // DIAGNOSTIC — confirm we entered the plan branch at all.
    ctx.bridge.emitSystemMessage(
      '[diag] entered plan branch — about to call setActiveTools',
      { hookName: 'permission-modes', hookEvent: 'SessionStart' },
    )

    try {
      pi.setActiveTools(PLAN_READONLY_TOOLS)
      ctx.bridge.emitSystemMessage(
        '[diag] setActiveTools returned — about to register exit_plan_mode',
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
    } catch (err) {
      ctx.bridge.emitSystemMessage(
        `[diag] setActiveTools THREW: ${err instanceof Error ? err.message : String(err)}`,
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
    }

    try {
      const lockDown = (): void => { pi.setActiveTools(PLAN_READONLY_TOOLS) }
      const onLifecycle = <E>(event: string): void => {
        ;(pi as unknown as { on: (e: string, h: (e: E) => void) => void }).on(event, lockDown)
      }
      onLifecycle<unknown>('before_agent_start')
      onLifecycle<unknown>('session_start')
      ctx.bridge.emitSystemMessage(
        '[diag] lifecycle lockdown hooks registered',
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
    } catch (err) {
      ctx.bridge.emitSystemMessage(
        `[diag] lifecycle hook registration THREW: ${err instanceof Error ? err.message : String(err)}`,
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
    }

    ctx.bridge.emitSystemMessage(
      `🔒 plan-mode detected: LLM restricted to ${PLAN_READONLY_TOOLS.join(', ')}. Call exit_plan_mode to unlock.`,
      { hookName: 'permission-modes', hookEvent: 'SessionStart' },
    )
    console.log('[permission-modes] plan mode: locked to', PLAN_READONLY_TOOLS.join(', '))

    const requireApproval = ctx.aiSettings.requirePlanApproval !== false

    try {
      ctx.bridge.emitSystemMessage(
        '[diag] about to call pi.registerTool(exit_plan_mode)',
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
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
          { hookName: 'permission-modes', hookEvent: 'PostToolUse' },
        )
        return { content: [{ type: 'text', text: 'Plan mode exited. Mutating tools are now available.' }] }
      },
    })
    ctx.bridge.emitSystemMessage(
      '[diag] pi.registerTool(exit_plan_mode) returned OK',
      { hookName: 'permission-modes', hookEvent: 'SessionStart' },
    )
    } catch (err) {
      ctx.bridge.emitSystemMessage(
        `[diag] registerTool THREW: ${err instanceof Error ? err.message : String(err)}`,
        { hookName: 'permission-modes', hookEvent: 'SessionStart' },
      )
    }
  }

  // Approval cache for dontAsk mode — session-scoped via ctx.sessionStore
  // so a decision survives across streamMessagePI invocations (i.e. across
  // user messages within the same conversation). Key = `${toolName}:${hashInput}`.
  const APPROVAL_CACHE_KEY = 'permissionModes.approvalCache'
  let approvalCache = ctx.sessionStore?.get(APPROVAL_CACHE_KEY) as Map<string, boolean> | undefined
  if (!approvalCache) {
    approvalCache = new Map<string, boolean>()
    ctx.sessionStore?.set(APPROVAL_CACHE_KEY, approvalCache)
  }

  pi.on('tool_call', async (event, extCtx) => {
    const decision = shouldRequireApproval(event.toolName, mode)
    console.log(`[permission-modes] tool_call tool=${event.toolName} mode=${mode} decision=${decision}`)
    // DIAGNOSTIC — in plan mode emit a system_message so the user can
    // confirm from the chat UI that the handler is firing at all and
    // see what toolName PI is actually dispatching.
    if (mode === 'plan') {
      ctx.bridge.emitSystemMessage(
        `🔍 plan-mode tool_call: tool="${event.toolName}" → decision=${decision}`,
        { hookName: 'permission-modes', hookEvent: 'PreToolUse' },
      )
    }
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
    let allowed: boolean
    try {
      allowed = await ui.confirm(title, message)
    } catch (err) {
      // UI disposed / conversation aborted / PiUIContext gone — default-deny.
      console.warn('[permission-modes] ui.confirm failed, default-deny:', err instanceof Error ? err.message : err)
      return { block: true, reason: 'Approval UI unavailable' }
    }

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
