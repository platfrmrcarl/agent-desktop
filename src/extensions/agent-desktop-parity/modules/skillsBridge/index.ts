import type { ExtensionAPI } from '../../shared/types'
import type { ExtensionRuntimeContext } from '../../../../core/services/piExtensionBridge'
import { getSkillPaths, type SkillScope } from '../../../../core/services/guards/skillsResolver'

const DISABLED_WARNED_KEY = 'skillsBridge.disabledWarned'

/**
 * Phase 4 — skills path bridge.
 *
 * Maps our `ai_skills` scope setting to PI's native skill discovery by
 * returning `{ skillPaths }` from the `resources_discover` event. PI
 * handles the rest natively (scanning SKILL.md, registering /skill:name
 * commands, system-prompt XML injection, on-demand load).
 *
 * This module does NOT:
 * - register slash commands (PI does it natively)
 * - inject SKILL.md content into prompts (PI does it natively)
 * - filter individual skills by name (PI exposes no extension hook for
 *   per-skill veto; see spec Open Question 5). Instead, when
 *   `disabledSkills` is non-empty, we emit a one-time warning to the
 *   conversation so the user knows the setting is not taking effect.
 */
export function initSkillsBridge(pi: ExtensionAPI, ctx: ExtensionRuntimeContext): void {
  const scope = ctx.aiSettings.skills as SkillScope | undefined
  const enabled = ctx.aiSettings.skillsEnabled !== false

  if (!scope || scope === 'off' || !enabled) return

  const disabled = ctx.aiSettings.disabledSkills ?? []
  if (disabled.length > 0 && !ctx.sessionStore.get(DISABLED_WARNED_KEY)) {
    ctx.sessionStore.set(DISABLED_WARNED_KEY, true)
    ctx.bridge.emitSystemMessage(
      `skills-bridge: disabledSkills (${disabled.join(', ')}) cannot be enforced on PI backend — PI discovers skills by directory scan and exposes no per-skill veto hook. The listed skills will still be visible to the agent. Move their SKILL.md files out of the scanned directories to hide them.`,
      { hookName: 'skills-bridge', hookEvent: 'SessionStart' },
    )
  }

  type DiscoverEvent = { cwd?: string }
  type DiscoverResult = { skillPaths?: string[] }
  const on = (pi as unknown as { on: (e: string, h: (e: DiscoverEvent) => DiscoverResult) => void }).on.bind(pi)

  on('resources_discover', (event) => {
    const cwd = ctx.aiSettings.cwd || event.cwd || process.cwd()
    return { skillPaths: getSkillPaths(cwd, scope) }
  })
}
