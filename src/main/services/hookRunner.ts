import { runHooks, type HookSystemMessage } from '../../core/services/hooks/hookRunner'
import type { HookRunner } from '../../core/ports/hookRunner'

export type { HookSystemMessage } from '../../core/services/hooks/hookRunner'

/**
 * Claude-path wrapper preserved for backward compatibility.
 * Delegates to the generic `runHooks` in `core/services/hooks/hookRunner`.
 */
export async function runUserPromptSubmitHooks(
  prompt: string,
  cwd: string,
  permissionMode: string,
): Promise<HookSystemMessage[]> {
  return runHooks(
    'UserPromptSubmit',
    {
      prompt,
      session_id: 'agent-desktop',
      permission_mode: permissionMode,
    },
    { cwd },
  )
}

/** Adapter satisfying the core HookRunner port for the Electron host. */
export const electronHookRunner: HookRunner = {
  runUserPromptSubmitHooks(userContent, cwd, permissionMode) {
    return runUserPromptSubmitHooks(userContent, cwd, permissionMode)
  },
}
