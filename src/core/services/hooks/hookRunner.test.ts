import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runHooks, type HookSystemMessage } from './hookRunner'

vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}))
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd, _opts, cb) => {
    cb?.(null, '', '')
    return { stdin: { write: vi.fn(), end: vi.fn() } }
  }),
}))

import { readFile } from 'node:fs/promises'
import { exec } from 'node:child_process'

const mockReadFile = vi.mocked(readFile)
const mockExec = vi.mocked(exec)

function mockHookConfig(settings: Record<string, unknown>) {
  mockReadFile.mockResolvedValueOnce(JSON.stringify(settings))
}

function mockExecOutput(output: string) {
  mockExec.mockImplementationOnce(((_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    cb(null, output)
    return { stdin: { write: vi.fn(), end: vi.fn() } }
  }) as never)
}

describe('runHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] when no hooks configured for the event', async () => {
    mockReadFile.mockResolvedValue('{}')
    const result = await runHooks('UserPromptSubmit', { prompt: 'hi' }, { cwd: '/tmp' })
    expect(result).toEqual([])
  })

  it('runs a single UserPromptSubmit hook and returns systemMessage', async () => {
    mockHookConfig({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo_hook' }] }] },
    })
    mockExecOutput(JSON.stringify({ systemMessage: 'context injected' }))
    const result = await runHooks('UserPromptSubmit', { prompt: 'hi' }, { cwd: '/tmp' })
    expect(result).toEqual<HookSystemMessage[]>([
      { content: 'context injected', hookEvent: 'UserPromptSubmit' },
    ])
  })

  it('filters PreToolUse hooks by matcher regex', async () => {
    mockHookConfig({
      hooks: {
        PreToolUse: [
          { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'write_hook' }] },
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash_hook' }] },
        ],
      },
    })
    mockExecOutput(JSON.stringify({ systemMessage: 'write-matched' }))
    const result = await runHooks(
      'PreToolUse',
      { tool_name: 'Write', tool_input: { path: '/x' } },
      { cwd: '/tmp' },
    )
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('write-matched')
    expect(mockExec).toHaveBeenCalledTimes(1)
  })

  it('parses decision:"deny" for PreToolUse', async () => {
    mockHookConfig({
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'deny_hook' }] }] },
    })
    mockExecOutput(JSON.stringify({ decision: 'deny', reason: 'forbidden path' }))
    const result = await runHooks(
      'PreToolUse',
      { tool_name: 'Write', tool_input: { path: '/x' } },
      { cwd: '/tmp' },
    )
    expect(result).toEqual<HookSystemMessage[]>([
      { content: '', hookEvent: 'PreToolUse', decision: 'deny', reason: 'forbidden path' },
    ])
  })

  it('silently skips non-JSON stdout', async () => {
    mockHookConfig({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'noisy_hook' }] }] },
    })
    mockExecOutput('This is not JSON, just chatter.')
    const result = await runHooks('UserPromptSubmit', { prompt: 'hi' }, { cwd: '/tmp' })
    expect(result).toEqual([])
  })

  it('respects per-hook timeout (seconds → milliseconds)', async () => {
    mockHookConfig({
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'slow', timeout: 30 }] }] },
    })
    mockExecOutput(JSON.stringify({ systemMessage: 'ok' }))
    await runHooks('UserPromptSubmit', { prompt: 'hi' }, { cwd: '/tmp' })
    const [, opts] = mockExec.mock.calls[0]
    expect((opts as { timeout?: number }).timeout).toBe(30_000)
  })

  it('reads from settingsPath option when provided', async () => {
    mockHookConfig({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop' }] }] } })
    mockExecOutput(JSON.stringify({ systemMessage: 'bye' }))
    await runHooks('Stop', {}, { cwd: '/tmp', settingsPath: '/custom/hooks.json' })
    expect(mockReadFile).toHaveBeenCalledWith('/custom/hooks.json', 'utf-8')
  })

  it('returns [] when settings file is missing or unreadable', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const result = await runHooks('UserPromptSubmit', { prompt: 'hi' }, { cwd: '/tmp' })
    expect(result).toEqual([])
  })
})
