import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { shouldRequireApproval, type PermissionMode } from '../../../../core/services/guards/permissionPolicy'
import { createHash } from 'node:crypto'
import { Type } from '@sinclair/typebox'

const VALID_MODES = ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan'] as const

// Plan mode tool set. MUST include `exit_plan_mode` so the agent can
// escape the lockdown — omitting it traps the LLM with no way out.
const PLAN_READONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'exit_plan_mode']
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
 * - plan: read-only lockdown (via before_agent_start/session_start
 *   lifecycle hooks) + exit_plan_mode custom tool
 *
 * Approval prompts use `extCtx.ui.confirm` (native PI) which routes through our
 * `PiUIContext` adapter to the Electron renderer. No new stream protocol.
 *
 * Tool names are lowercase (PI convention); `shouldRequireApproval` handles
 * case normalization internally so the same policy works for Claude too.
 *
 * Lockdown timing note: `pi.setActiveTools` is an "action method" that PI
 * forbids during extension loading (throws "Extension runtime not
 * initialized"). We defer the call to the lifecycle events that fire AFTER
 * the session is ready. The `tool_call` handler is the final authority if
 * any mutating tool still reaches the LLM.
 */
export function initPermissionModes(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  // Plan-mode escape state lives in sessionStore so a successful
  // exit_plan_mode survives across turns. Read BEFORE mode resolution so
  // the entire plan branch short-circuits when the user already exited.
  const PLAN_EXITED_KEY = 'permissionModes.planExited'

  const modeRaw = ctx.aiSettings.permissionMode ?? 'default'
  let mode: PermissionMode = (VALID_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PermissionMode)
    : 'default'

  // If the user already exited plan mode on an earlier turn of this
  // conversation, treat the effective mode as bypassPermissions. This
  // ensures EVERY downstream check (tool_call handler, lockdown hook,
  // exit_plan_mode re-registration) short-circuits consistently, rather
  // than each one needing to re-check the flag individually.
  //
  // This was the architectural mistake of fix #4: two separate states
  // (captured `mode` + sessionStore flag) drifted apart, so the
  // tool_call handler still denied writes even after setActiveTools
  // restored them. Now there's one source of truth: the computed `mode`.
  const planExitedFlag = ctx.sessionStore?.get(PLAN_EXITED_KEY)
  if (mode === 'plan' && planExitedFlag) {
    mode = 'bypassPermissions'
  }

  // DIAGNOSTIC — single emit per factory init showing the resolved mode
  // and the raw inputs. Lets us see from the chat UI whether:
  //   (a) sessionStore flag is persisted across turns (planExitedFlag)
  //   (b) the flag is being read correctly (mode resolution)
  //   (c) the short-circuit is taking effect (early return below)
  ctx.bridge.emitSystemMessage(
    `[diag] perm-modes init: rawMode=${JSON.stringify(modeRaw)}, planExited=${JSON.stringify(planExitedFlag)}, effective=${mode}, convId=${ctx.conversationId}`,
    { hookName: 'permission-modes', hookEvent: 'SessionStart' },
  )

  // bypassPermissions (either explicit setting OR post-exit plan):
  // no handler registered, no lockdown, PI default behavior preserved.
  if (mode === 'bypassPermissions') return

  // Plan mode: lock to read-only tools (via lifecycle hooks, since
  // setActiveTools cannot be called at factory init) and register
  // exit_plan_mode as the escape hatch.
  if (mode === 'plan') {
    // No flag re-check here: the factory top-level already downgraded
    // mode to bypassPermissions (and early-returned) when planExited is
    // set. If we reach this lockDown, plan mode is genuinely active.
    const lockDown = (): void => {
      try { pi.setActiveTools(PLAN_READONLY_TOOLS) }
      catch (err) {
        console.warn('[permission-modes] setActiveTools lockdown failed:', err instanceof Error ? err.message : err)
      }
    }
    const onLifecycle = <E>(event: string): void => {
      ;(pi as unknown as { on: (e: string, h: (e: E) => void) => void }).on(event, lockDown)
    }
    onLifecycle<unknown>('before_agent_start')
    onLifecycle<unknown>('session_start')

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
        // Mark the conversation as exited BEFORE calling setActiveTools.
        // This flag is the source of truth; the factory's effective-mode
        // resolution picks it up on subsequent turns to skip the plan
        // branch entirely.
        ctx.sessionStore?.set(PLAN_EXITED_KEY, true)
        // DIAGNOSTIC — confirm write landed in the same Map instance.
        ctx.bridge.emitSystemMessage(
          `[diag] exit_plan_mode: set flag. sessionStore now has ${ctx.sessionStore?.size ?? '?'} keys, planExited=${JSON.stringify(ctx.sessionStore?.get(PLAN_EXITED_KEY))}`,
          { hookName: 'permission-modes', hookEvent: 'PostToolUse' },
        )
        // Best-effort mid-turn refresh. PI may cache the tool list per
        // LLM call, so this might not take effect until the next turn —
        // we tell the agent explicitly to STOP and wait for the user
        // (matching PI's plan-mode example pattern where mode changes
        // happen BETWEEN turns, not within one).
        try { pi.setActiveTools(DEFAULT_TOOLS) } catch { /* best-effort */ }
        ctx.bridge.emitSystemMessage(
          'Plan mode exited — mutating tools will be available on the next turn.',
          { hookName: 'permission-modes', hookEvent: 'PostToolUse' },
        )
        return {
          content: [{
            type: 'text',
            text:
              'Plan-mode exit approved by the user. STOP your current reasoning and do NOT attempt further tool calls in this turn. ' +
              'Mutating tools (write, edit, bash) will be fully available starting with the USER\'S NEXT MESSAGE. ' +
              'Briefly acknowledge the approval and wait.',
          }],
        }
      },
    })
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
    // Our own escape-hatch tool always passes straight through — the
    // exit_plan_mode tool is the only legal way OUT of plan mode, and
    // its execute() handler enforces the requirePlanApproval gate
    // itself. Blocking it here would trap the agent.
    if (event.toolName === 'exit_plan_mode') return undefined

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
