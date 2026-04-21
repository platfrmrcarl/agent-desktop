import { describe, it, expect } from 'vitest'
import { getSkillPaths, type SkillScope } from './skillsResolver'
import { homedir } from 'node:os'
import path from 'node:path'

const HOME = homedir()

describe('getSkillPaths', () => {
  it('returns empty array for off', () => {
    expect(getSkillPaths('/project', 'off')).toEqual([])
  })

  it('returns user scope paths', () => {
    expect(getSkillPaths('/project', 'user')).toEqual([
      path.join(HOME, '.claude/skills'),
      path.join(HOME, '.claude/plugins'),
    ])
  })

  it('returns user + project scope paths', () => {
    expect(getSkillPaths('/project', 'project')).toEqual([
      path.join(HOME, '.claude/skills'),
      path.join(HOME, '.claude/plugins'),
      '/project/.claude/skills',
      '/project/.claude/plugins',
    ])
  })

  it('returns project + local scope paths', () => {
    expect(getSkillPaths('/project', 'local')).toEqual([
      path.join(HOME, '.claude/skills'),
      path.join(HOME, '.claude/plugins'),
      '/project/.claude/skills',
      '/project/.claude/plugins',
      '/project/.claude.local/skills',
      '/project/.claude.local/plugins',
    ])
  })

  it('does not include project paths when scope is user', () => {
    const paths = getSkillPaths('/project', 'user')
    expect(paths.some(p => p.includes('/project'))).toBe(false)
  })
})
