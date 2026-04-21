import type { ExtensionAPI, ExtensionRuntimeContext } from '../../shared/types'
import { runHooks, type HookSystemMessage } from '../../../../core/services/hooks/hookRunner'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Phase 3 — hooks system adapter.
 *
 * Bridges PI's native event API to the Claude-compatible config-file
 * hook system. Reads `~/.claude/settings.json` (default) or
 * `~/.agent-desktop/hooks.json` (when `sharedHooks === false`), and for
 * each configured hook matching a PI event, execs the command with a
 * JSON-on-stdin payload, parses JSON stdout, and emits systemMessage /
 * enforces decision=deny via the bridge.
 *
 * Plus: fires `aiSettings.webhookCompletionUrl` (if set) on `agent_end`.
 */
export function initHooksSystem(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const cwd = ctx.aiSettings.cwd || process.cwd()
  const sharedHooks = ctx.aiSettings.sharedHooks !== false
  const settingsPath = sharedHooks
    ? join(homedir(), '.claude', 'settings.json')
    : join(homedir(), '.agent-desktop', 'hooks.json')
  const runOpts = { cwd, settingsPath }

  const emit = (msg: HookSystemMessage): void => {
    if (!msg.content) return
    ctx.bridge.emitSystemMessage(msg.content, {
      hookName: msg.hookEvent,
      hookEvent: msg.hookEvent,
    })
  }

  // UserPromptSubmit — PI's `input` event, user text
  pi.on('input' as never, async (event: unknown) => {
    const text = (event as { text?: string }).text ?? ''
    const results = await runHooks('UserPromptSubmit', { prompt: text }, runOpts)
    for (const r of results) emit(r)
    return undefined
  })

  // PreToolUse — PI's `tool_call` event; may block
  pi.on('tool_call' as never, async (event: unknown) => {
    const e = event as { toolName: string; input: Record<string, unknown> }
    const results = await runHooks(
      'PreToolUse',
      { tool_name: e.toolName, tool_input: e.input },
      runOpts,
    )
    for (const r of results) emit(r)
    const deny = results.find(r => r.decision === 'deny')
    if (deny) return { block: true, reason: deny.reason ?? 'Blocked by PreToolUse hook' }
    return undefined
  })

  // PostToolUse — PI's `tool_result` event; emit-only
  pi.on('tool_result' as never, async (event: unknown) => {
    const e = event as { toolName: string; result: unknown }
    const results = await runHooks(
      'PostToolUse',
      { tool_name: e.toolName, tool_response: e.result },
      runOpts,
    )
    for (const r of results) emit(r)
    return undefined
  })

  // SessionStart — PI's `session_start` event
  pi.on('session_start' as never, async (event: unknown) => {
    const e = event as { reason?: string }
    const results = await runHooks('SessionStart', { reason: e.reason }, runOpts)
    for (const r of results) emit(r)
    return undefined
  })

  // Stop + webhook — PI's `agent_end` event
  pi.on('agent_end' as never, async () => {
    const results = await runHooks('Stop', {}, runOpts)
    for (const r of results) emit(r)

    if (ctx.aiSettings.webhookCompletionUrl) {
      try {
        await fetch(ctx.aiSettings.webhookCompletionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: ctx.conversationId,
            timestamp: new Date().toISOString(),
          }),
        })
      } catch (err) {
        console.warn('[hooks-system] webhook POST failed:', err instanceof Error ? err.message : err)
      }
    }
    return undefined
  })
}
