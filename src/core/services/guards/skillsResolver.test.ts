import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getSkillPaths, readInstalledPluginSkillPaths, type SkillScope } from './skillsResolver'
import { homedir, tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const HOME = homedir()

describe('getSkillPaths', () => {
  it('returns empty array for off', () => {
    expect(getSkillPaths('/project', 'off')).toEqual([])
  })

  it('returns user scope paths', () => {
    expect(getSkillPaths('/project', 'user')).toEqual([
      path.join(HOME, '.claude/skills'),
    ])
  })

  it('returns user + project scope paths', () => {
    expect(getSkillPaths('/project', 'project')).toEqual([
      path.join(HOME, '.claude/skills'),
      '/project/.claude/skills',
    ])
  })

  it('returns project + local scope paths', () => {
    expect(getSkillPaths('/project', 'local')).toEqual([
      path.join(HOME, '.claude/skills'),
      '/project/.claude/skills',
      '/project/.claude.local/skills',
    ])
  })

  it('does not include project paths when scope is user', () => {
    const paths = getSkillPaths('/project', 'user')
    expect(paths.some(p => p.includes('/project'))).toBe(false)
  })

  it('does not include any plugins/ directory (prevents overlap with PI npm packages)', () => {
    for (const scope of ['user', 'project', 'local'] as SkillScope[]) {
      const paths = getSkillPaths('/project', scope)
      expect(paths.every(p => !p.endsWith('/plugins'))).toBe(true)
    }
  })
})

describe('readInstalledPluginSkillPaths', () => {
  let tmp: string
  let configPath: string

  beforeAll(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'skillsResolver-'))
    configPath = path.join(tmp, 'installed_plugins.json')

    // Plugin A: has skills/ — should be included
    const pluginAPath = path.join(tmp, 'plugin-a', '1.0.0')
    mkdirSync(path.join(pluginAPath, 'skills', 'sample-skill'), { recursive: true })

    // Plugin B: no skills/ — should be excluded
    const pluginBPath = path.join(tmp, 'plugin-b', '1.0.0')
    mkdirSync(pluginBPath, { recursive: true })

    // Plugin C: installPath points nowhere — should be excluded (stat throws)
    const pluginCPath = path.join(tmp, 'plugin-c-missing')

    writeFileSync(configPath, JSON.stringify({
      version: 2,
      plugins: {
        'plugin-a@market': [{ installPath: pluginAPath, scope: 'user' }],
        'plugin-b@market': [{ installPath: pluginBPath, scope: 'user' }],
        'plugin-c@market': [{ installPath: pluginCPath, scope: 'user' }],
      },
    }))
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns skill dirs only for plugins whose skills/ subdir exists', () => {
    const paths = readInstalledPluginSkillPaths(configPath)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toBe(path.join(tmp, 'plugin-a', '1.0.0', 'skills'))
  })

  it('returns [] when the config file is missing', () => {
    expect(readInstalledPluginSkillPaths(path.join(tmp, 'does-not-exist.json'))).toEqual([])
  })

  it('returns [] when the config is not valid JSON', () => {
    const badPath = path.join(tmp, 'bad.json')
    writeFileSync(badPath, 'not json at all')
    expect(readInstalledPluginSkillPaths(badPath)).toEqual([])
  })

  it('returns [] when plugins map is absent', () => {
    const emptyPath = path.join(tmp, 'empty.json')
    writeFileSync(emptyPath, JSON.stringify({ version: 2 }))
    expect(readInstalledPluginSkillPaths(emptyPath)).toEqual([])
  })

  it('skips entries with no installPath', () => {
    const brokenPath = path.join(tmp, 'broken.json')
    writeFileSync(brokenPath, JSON.stringify({
      version: 2,
      plugins: { 'x@market': [{ scope: 'user' } as { scope: string }] },
    }))
    expect(readInstalledPluginSkillPaths(brokenPath)).toEqual([])
  })
})
