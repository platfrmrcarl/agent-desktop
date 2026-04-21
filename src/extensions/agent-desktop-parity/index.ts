import type { ExtensionAPI, ExtensionRuntimeContext } from './shared/types'

/**
 * Default extension factory for the Agent Desktop PI parity extension.
 *
 * Called by streamingPI.ts per turn via DefaultResourceLoader.extensionFactories.
 * Receives the PI ExtensionAPI plus our runtime context (per-conversation
 * resolved aiSettings, bridge, db handle).
 *
 * Phase 0: no-op — only validates that the wiring works end-to-end.
 * Future phases (1-5) register event handlers here.
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

  // Touch `pi` once so TypeScript recognizes the closure as non-trivial —
  // prevents tree-shaking / dead-code elimination from dropping the factory
  // in production builds. Replaced by real handler registration in Phase 1+.
  void pi

  // Phase 0: no module inits yet. Future:
  //   if (!disabled.has('cwd-guard'))        initCwdGuard(pi, ctx)
  //   if (!disabled.has('permission-modes')) initPermissionModes(pi, ctx)
  //   ...
  void disabled
}
