import { buildCwdRestrictionHooks } from './cwdHooks'
import { mcpServerWildcard } from '../utils/mcpNames'
import type { AISettings } from './streaming'

/**
 * Apply AI settings (cwd restriction, tools, MCP servers, skills sources)
 * to a Claude Agent SDK `query()` options object in-place.
 *
 * Centralizes the option-building logic that was duplicated between
 * `core/services/streaming.ts` and `main/services/sessionManager.ts`.
 * The handful of fields touched here mirror the SDK's `QueryOptions`
 * shape; we use `Record<string, unknown>` because the SDK type isn't
 * imported in core to avoid pulling in Electron transitively.
 */
export function applyAiSettingsToQueryOptions(
  queryOptions: Record<string, unknown>,
  aiSettings: AISettings | undefined,
): void {
  if (!aiSettings) return

  // CWD restriction hooks — runs independently of permission mode (even in bypass).
  // Uses the SDK hooks API: PreToolUse hook with 'deny' decision for out-of-CWD writes.
  if (aiSettings.cwdRestrictionEnabled && aiSettings.cwd) {
    queryOptions.hooks = buildCwdRestrictionHooks(aiSettings.cwd, aiSettings.cwdWhitelist || [])
  }

  if (aiSettings.tools) {
    queryOptions.tools = aiSettings.tools
  }

  if (aiSettings.mcpServers && Object.keys(aiSettings.mcpServers).length > 0) {
    queryOptions.mcpServers = aiSettings.mcpServers
    // MCP tools require explicit allowedTools wildcards for the SDK to permit their use.
    const mcpWildcards = Object.keys(aiSettings.mcpServers).map((name) => mcpServerWildcard(name))
    queryOptions.allowedTools = [
      ...(Array.isArray(queryOptions.allowedTools) ? (queryOptions.allowedTools as string[]) : []),
      ...mcpWildcards,
    ]
  }

  // Setting Sources: load configuration from filesystem (independent of skills toggle).
  if (aiSettings.skills && aiSettings.skills !== 'off') {
    const sourceMap: Record<string, string[]> = {
      user: ['user'],
      project: ['user', 'project'],
      local: ['user', 'project', 'local'],
    }
    queryOptions.settingSources = sourceMap[aiSettings.skills] || ['user']
  }

  // Skills tool: only add when sources are active AND the skills toggle is on.
  if (aiSettings.skills && aiSettings.skills !== 'off' && aiSettings.skillsEnabled !== false) {
    queryOptions.allowedTools = [
      ...(Array.isArray(queryOptions.allowedTools) ? (queryOptions.allowedTools as string[]) : []),
      'Skill',
    ]
  }
}
