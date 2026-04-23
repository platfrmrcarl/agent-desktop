import { describe, it, expect } from 'vitest'
import { shouldRequireApproval, type PermissionMode } from './permissionPolicy'

const modes: PermissionMode[] = ['bypassPermissions', 'acceptEdits', 'default', 'dontAsk', 'plan']

describe('shouldRequireApproval', () => {
  it('bypassPermissions allows every tool', () => {
    for (const tool of ['Write', 'Edit', 'Bash', 'Read', 'Glob']) {
      expect(shouldRequireApproval(tool, 'bypassPermissions')).toBe('allow')
    }
  })

  it('plan mode denies mutating tools, allows reads', () => {
    expect(shouldRequireApproval('Write', 'plan')).toBe('deny')
    expect(shouldRequireApproval('Edit', 'plan')).toBe('deny')
    expect(shouldRequireApproval('Bash', 'plan')).toBe('deny')
    expect(shouldRequireApproval('Read', 'plan')).toBe('allow')
    expect(shouldRequireApproval('Glob', 'plan')).toBe('allow')
    expect(shouldRequireApproval('Grep', 'plan')).toBe('allow')
  })

  it('acceptEdits auto-allows Write/Edit but asks for Bash', () => {
    expect(shouldRequireApproval('Write', 'acceptEdits')).toBe('allow')
    expect(shouldRequireApproval('Edit', 'acceptEdits')).toBe('allow')
    expect(shouldRequireApproval('Bash', 'acceptEdits')).toBe('ask')
  })

  it('default asks for write/edit/bash', () => {
    expect(shouldRequireApproval('Write', 'default')).toBe('ask')
    expect(shouldRequireApproval('Edit', 'default')).toBe('ask')
    expect(shouldRequireApproval('Bash', 'default')).toBe('ask')
    expect(shouldRequireApproval('Read', 'default')).toBe('allow')
  })

  it('dontAsk behaves like default (cache is module-level, not policy-level)', () => {
    expect(shouldRequireApproval('Write', 'dontAsk')).toBe('ask')
    expect(shouldRequireApproval('Read', 'dontAsk')).toBe('allow')
  })

  it('every mode returns a value for unknown tools', () => {
    for (const mode of modes) {
      const result = shouldRequireApproval('SomeUnknownTool', mode)
      expect(['allow', 'deny', 'ask']).toContain(result)
    }
  })
})
