import { describe, it, expect } from 'vitest'
import { buildCwdRestrictionHooks } from './cwdHooks'
import type { CwdWhitelistEntry } from '../types'

/**
 * Security invariant tests for cwdRestrictionHook.
 *
 * These tests specifically guard the constraints documented in CLAUDE.md:
 *   - CWD hooks: return 'deny' (NOT 'ask') — bypass mode auto-approves 'ask'
 *   - CWD whitelist read restriction: only enforced when whitelist is non-empty
 *   - Bash read commands covered: cat, head, tail, less, find, ls, tree, file, stat, wc, diff, strings, xxd
 */

const CWD = '/home/user/project'
const abortController = new AbortController()
const ctx = { signal: abortController.signal }

function makeInput(toolName: string, toolInput: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    session_id: 'test',
    cwd: CWD,
  }
}

async function invoke(hooks: ReturnType<typeof buildCwdRestrictionHooks>, toolName: string, toolInput: Record<string, unknown>) {
  const cb = hooks.PreToolUse[0].hooks[0]
  return cb(makeInput(toolName, toolInput), null, ctx)
}

// ─── SECURITY INVARIANT: always 'deny', never 'ask' ─────────

describe('deny vs ask invariant', () => {
  it('Write outside CWD returns deny (not ask)', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Write', { file_path: '/tmp/evil.txt' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(result.hookSpecificOutput?.permissionDecision).not.toBe('ask')
  })

  it('Edit outside CWD returns deny (not ask)', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Edit', { file_path: '/etc/passwd' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('NotebookEdit outside CWD returns deny (not ask)', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('Bash write outside CWD returns deny (not ask)', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Bash', { command: 'echo x > /tmp/out.txt' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('Read outside CWD with whitelist returns deny (not ask)', async () => {
    const whitelist: CwdWhitelistEntry[] = [{ path: '/data/kb', access: 'read' }]
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Read', { file_path: '/tmp/secret.txt' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })
})

// ─── SECURITY INVARIANT: empty whitelist = unrestricted reads ─

describe('empty whitelist — reads unrestricted, writes to CWD only', () => {
  it('Read outside CWD is allowed when no whitelist', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Read', { file_path: '/etc/passwd' })
    expect(result).toEqual({})
  })

  it('Glob outside CWD is allowed when no whitelist', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Glob', { path: '/tmp', pattern: '**' })
    expect(result).toEqual({})
  })

  it('Grep outside CWD is allowed when no whitelist', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Grep', { path: '/tmp', pattern: 'secret' })
    expect(result).toEqual({})
  })

  it('Bash cat outside CWD is allowed when no whitelist', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Bash', { command: 'cat /etc/hosts' })
    expect(result).toEqual({})
  })

  it('Write outside CWD is denied when no whitelist', async () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    const result = await invoke(hooks, 'Write', { file_path: '/tmp/evil.txt' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('matcher does NOT include Read|Glob|Grep when no whitelist', () => {
    const hooks = buildCwdRestrictionHooks(CWD)
    expect(hooks.PreToolUse[0].matcher).toBe('Write|Edit|NotebookEdit|Bash')
    expect(hooks.PreToolUse[0].matcher).not.toContain('Read')
  })
})

// ─── SECURITY INVARIANT: populated whitelist restricts reads ──

describe('populated whitelist — reads and writes both restricted', () => {
  const whitelist: CwdWhitelistEntry[] = [
    { path: '/data/readonly', access: 'read' },
    { path: '/data/writable', access: 'readwrite' },
  ]

  it('matcher includes Read|Glob|Grep when whitelist present', () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    expect(hooks.PreToolUse[0].matcher).toContain('Read')
    expect(hooks.PreToolUse[0].matcher).toContain('Glob')
    expect(hooks.PreToolUse[0].matcher).toContain('Grep')
  })

  it('Read inside read-only whitelist entry is allowed', async () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Read', { file_path: '/data/readonly/file.md' })
    expect(result).toEqual({})
  })

  it('Read outside all entries is denied', async () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Read', { file_path: '/tmp/secret.txt' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('Write inside read-only entry is denied', async () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Write', { file_path: '/data/readonly/file.md' })
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('Write inside readwrite entry is allowed', async () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Write', { file_path: '/data/writable/out.txt' })
    expect(result).toEqual({})
  })
})

// ─── SECURITY INVARIANT: Bash read commands list ─────────────

describe('Bash read commands restricted by whitelist', () => {
  const whitelist: CwdWhitelistEntry[] = [{ path: '/data/kb', access: 'read' }]

  const readCommands: Array<[string, string]> = [
    ['cat', 'cat /tmp/secret.txt'],
    ['head', 'head -n 5 /tmp/secret.txt'],
    ['tail', 'tail -f /tmp/secret.txt'],
    ['less', 'less /tmp/secret.txt'],
    ['find', 'find /tmp -name "*.txt"'],
    ['ls', 'ls -la /tmp/dir'],
    ['tree', 'tree /tmp/project'],
    ['file', 'file /tmp/binary'],
    ['stat', 'stat /tmp/file.txt'],
    ['wc', 'wc -l /tmp/file.txt'],
    ['diff', 'diff /tmp/a.txt /tmp/b.txt'],
    ['strings', 'strings /tmp/binary'],
    ['xxd', 'xxd /tmp/file'],
  ]

  for (const [cmd, command] of readCommands) {
    it(`Bash ${cmd} outside whitelist is denied when whitelist is set`, async () => {
      const hooks = buildCwdRestrictionHooks(CWD, whitelist)
      const result = await invoke(hooks, 'Bash', { command })
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
    })
  }

  it('Bash cat inside whitelist path is allowed', async () => {
    const hooks = buildCwdRestrictionHooks(CWD, whitelist)
    const result = await invoke(hooks, 'Bash', { command: 'cat /data/kb/notes.md' })
    expect(result).toEqual({})
  })
})
