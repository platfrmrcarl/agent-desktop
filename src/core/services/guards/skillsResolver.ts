import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export type SkillScope = 'off' | 'user' | 'project' | 'local'

/**
 * Returns the ordered list of filesystem paths to scan for skills,
 * given a workspace root and scope.
 *
 * Consumed by the PI skillsBridge extension module via the
 * `resources_discover` event. Claude-SDK uses analogous paths indirectly
 * via the `settingSources` option passed to `query()`.
 *
 * IMPORTANT — `~/.claude/plugins/` and `<cwd>/.claude/plugins/` are
 * intentionally NOT included here. Those directories contain marketplace
 * catalogs + cached plugin versions that often overlap 1:1 with skills
 * the user already installs in PI via npm packages
 * (e.g. `pi-superpowers-plus`). Exposing them blindly would duplicate
 * the superpowers bundle and cause slash-command collisions
 * (`/brainstorming` on both paths).
 *
 * Only top-level `skills/` directories are exposed (not `plugins/` —
 * those are user-custom skills that have no other path into PI).
 *
 * To include skills from CLAUDE-INSTALLED plugins (curated, not the
 * whole marketplace), use `readInstalledPluginSkillPaths()` and
 * concatenate — the module does this behind the
 * `skillsIncludePlugins` setting.
 */
export function getSkillPaths(cwd: string, scope: SkillScope): string[] {
  if (scope === 'off') return []

  const userPaths = [
    path.join(homedir(), '.claude/skills'),
  ]
  if (scope === 'user') return userPaths

  const projectPaths = [
    ...userPaths,
    path.join(cwd, '.claude/skills'),
  ]
  if (scope === 'project') return projectPaths

  // local
  return [
    ...projectPaths,
    path.join(cwd, '.claude.local/skills'),
  ]
}

interface InstalledPluginEntry {
  installPath?: string
  scope?: string
}

interface InstalledPluginsConfig {
  version?: number
  plugins?: Record<string, InstalledPluginEntry[]>
}

/**
 * Reads `~/.claude/plugins/installed_plugins.json` and returns the list
 * of `<installPath>/skills` directories for each currently-installed
 * Claude plugin.
 *
 * Filters out entries whose `skills/` subdirectory does not exist —
 * plugins can ship without skills (slash commands only, etc.).
 *
 * Returns `[]` if the config file is missing, unreadable, or has no
 * plugins. Safe to call at startup or per-turn.
 *
 * The optional `configPath` argument is for testing; production callers
 * should omit it to use the default `~/.claude/plugins/installed_plugins.json`.
 */
export function readInstalledPluginSkillPaths(configPath?: string): string[] {
  const resolved = configPath ?? path.join(homedir(), '.claude/plugins/installed_plugins.json')
  let config: InstalledPluginsConfig
  try {
    const raw = readFileSync(resolved, 'utf-8')
    config = JSON.parse(raw) as InstalledPluginsConfig
  } catch {
    return []
  }
  if (!config.plugins) return []

  const result: string[] = []
  for (const entries of Object.values(config.plugins)) {
    for (const entry of entries) {
      if (!entry.installPath) continue
      const skillsDir = path.join(entry.installPath, 'skills')
      try {
        const s = statSync(skillsDir)
        if (s.isDirectory()) result.push(skillsDir)
      } catch {
        // skills/ absent — plugin has no skills, skip silently
      }
    }
  }
  return result
}
