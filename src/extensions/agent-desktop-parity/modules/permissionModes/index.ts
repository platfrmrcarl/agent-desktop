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
  const modeRaw = ctx.aiSettings.permissionMode ?? 'default'
  const mode: PermissionMode = (VALID_MODES as readonly string[]).includes(modeRaw)
    ? (modeRaw as PermissionMode)
    : 'default'

  // bypassPermissions: no tool_call handler — PI default allows everything.
  // This is also where the conversation lands AFTER exit_plan_mode persists
  // 'bypassPermissions' back to ai_overrides. The cascade delivers it here
  // on the next turn → factory short-circuits → Write/Edit/Bash intact.
  if (mode === 'bypassPermissions') return

  // Plan mode: lock to read-only tools (via lifecycle hooks, since
  // setActiveTools cannot be called at factory init) and register
  // exit_plan_mode as the escape hatch.
  if (mode === 'plan') {
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

    pi.registerTool({
      name: 'exit_plan_mode',
      label: 'Exit Plan Mode',
      description: 'Signal that your plan is ready for the user to review. Provide the plan text as the `plan` parameter in markdown. The user will approve (unlocking mutating tools from the next message) or reject with feedback so you can revise.',
      parameters: Type.Object({
        plan: Type.String({ description: 'The proposed plan in markdown format.' }),
      }),
      execute: async (_toolCallId, params, _signal, _onUpdate, _extCtx) => {
        const plan = (params as { plan?: string }).plan ?? ''
        // Emits a tool_approval chunk with toolName='ExitPlanMode' that the
        // existing renderer ToolApprovalBlock component special-cases —
        // renders the plan as markdown, offers Approve / Reject buttons,
        // and captures a rejection-feedback textarea. Blocks until the
        // user responds via respondToApproval IPC.
        const result = await ctx.bridge.requestPlanApproval(plan)
        if (result.approved) {
          // Persist the flip to ai_overrides — cascade delivers
          // bypassPermissions on next turn, factory early-returns, mutating
          // tools intact in the default codingTools set. Status bar updates
          // immediately via notifyConversationUpdated.
          ctx.bridge.updateConversationSetting('ai_permissionMode', 'bypassPermissions')
          return {
            content: [{
              type: 'text',
              text:
                'Plan approved. The user has unlocked mutating tools. ' +
                'Mutating tools (write, edit, bash) will be available from the user\'s next message — ' +
                'briefly acknowledge the approval and wait for the user to send the next instruction.',
            }],
          }
        }
        const feedback = result.rejectReason && result.rejectReason.trim().length > 0
          ? result.rejectReason
          : '(no specific feedback provided)'
        return {
          content: [{
            type: 'text',
            text: `Plan rejected by user. Feedback:\n\n${feedback}\n\nRevise the plan accordingly, then call exit_plan_mode again when ready.`,
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
