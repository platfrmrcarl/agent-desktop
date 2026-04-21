import type { ExtensionAPI, ExtensionRuntimeContext } from './shared/types'
import { initCwdGuard } from './modules/cwdGuard'

/**
 * Default extension factory for the Agent Desktop PI parity extension.
 *
 * Called by streamingPI.ts per turn via DefaultResourceLoader.extensionFactories.
 * Receives the PI ExtensionAPI plus our runtime context (per-conversation
 * resolved aiSettings, bridge, db handle).
 */
export default function (pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  if (ctx.version !== 1) {
    console.warn(`[agent-desktop-parity] unexpected ctx.version ${ctx.version}, expected 1`)
    return
  }

  const disabled = new Set<string>(
    Array.isArray((ctx.aiSettings as Record<string, unknown>).agent_parity_disabledModules)
      ? ((ctx.aiSettings as Record<string, unknown>).agent_parity_disabledModules as string[])
      : [],
  )

  // Safety modules first: `tool_call` handlers chain in registration order and
  // the first `{ block: true }` wins — cwd-guard MUST precede permission-modes
  // so a path-based deny cannot be reordered behind a mode-based decision.
  if (!disabled.has('cwd-guard')) initCwdGuard(pi, ctx)
  // Future modules will be added here in Phases 2-5:
  //   if (!disabled.has('permission-modes')) initPermissionModes(pi, ctx)
  //   if (!disabled.has('skills-bridge'))    initSkillsBridge(pi, ctx)
  //   if (!disabled.has('hooks-system'))     initHooksSystem(pi, ctx)
  //   if (!disabled.has('budget-tracker'))   initBudgetTracker(pi, ctx)
}
