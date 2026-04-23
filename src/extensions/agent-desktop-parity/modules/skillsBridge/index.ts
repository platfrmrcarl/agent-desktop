import type { ExtensionAPI } from '../../shared/types'
import type { ExtensionRuntimeContext } from '../../../../core/services/piExtensionBridge'
import { getSkillPaths, readInstalledPluginSkillPaths, type SkillScope } from '../../../../core/services/guards/skillsResolver'

const DISABLED_WARNED_KEY = 'skillsBridge.disabledWarned'

/**
 * Phase 4 — skills path bridge.
 *
 * Maps our `ai_skills` scope setting to PI's native skill discovery by
 * returning `{ skillPaths }` from the `resources_discover` event. PI
 * handles the rest natively (scanning SKILL.md, registering /skill:name
 * commands, system-prompt XML injection, on-demand load).
 *
 * Gating (three gates, ALL must pass for the module to contribute paths):
 *   1. `aiSettings.skills` scope ≠ 'off' / undefined
 *   2. `aiSettings.skillsEnabled` ≠ false
 *   3. `aiSettings.sharedHooks` ≠ false  — the "Share Claude Config"
 *      setting. When the user has opted out of sharing Claude config with
 *      the PI backend, we respect that globally: no skill paths exposed.
 *      This avoids duplicating with skills already available via PI's
 *      own npm packages (pi-superpowers-plus, etc.).
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
  const shareClaudeConfig = ctx.aiSettings.sharedHooks !== false

  if (!scope || scope === 'off' || !enabled || !shareClaudeConfig) return

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

  const includePlugins = ctx.aiSettings.skillsIncludePlugins === true

  on('resources_discover', (event) => {
    const cwd = ctx.aiSettings.cwd || event.cwd || process.cwd()
    const base = getSkillPaths(cwd, scope)
    const plugins = includePlugins ? readInstalledPluginSkillPaths() : []
    return { skillPaths: [...base, ...plugins] }
  })
}
