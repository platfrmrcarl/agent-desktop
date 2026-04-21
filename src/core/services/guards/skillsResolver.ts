import { homedir } from 'node:os'
import path from 'node:path'

export type SkillScope = 'off' | 'user' | 'project' | 'local'

/**
 * Returns the ordered list of filesystem paths to scan for skills,
 * given a workspace root and scope.
 *
 * Consumed by the PI skillsBridge extension module, which writes
 * these paths into PI's native `skills` setting via
 * settingsManager.applyOverrides(). Claude-SDK uses these same paths
 * indirectly via the `settingSources` option passed to `query()`.
 */
export function getSkillPaths(cwd: string, scope: SkillScope): string[] {
  if (scope === 'off') return []

  const userPaths = [
    path.join(homedir(), '.claude/skills'),
    path.join(homedir(), '.claude/plugins'),
  ]
  if (scope === 'user') return userPaths

  const projectPaths = [
    ...userPaths,
    path.join(cwd, '.claude/skills'),
    path.join(cwd, '.claude/plugins'),
  ]
  if (scope === 'project') return projectPaths

  // local
  return [
    ...projectPaths,
    path.join(cwd, '.claude.local/skills'),
    path.join(cwd, '.claude.local/plugins'),
  ]
}
