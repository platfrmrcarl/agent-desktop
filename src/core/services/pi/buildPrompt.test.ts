import { describe, it, expect, vi } from 'vitest'

// Mock buildPromptWithHistory to keep unit scope tight
const mockBuildPromptWithHistory = vi.fn((msgs: { role: string; content: string }[]) => {
  // Minimal faithful implementation for test assertions
  const last = msgs[msgs.length - 1]?.content ?? ''
  if (msgs.length <= 1) return last
  const history = msgs
    .slice(0, -1)
    .map((m) => `<msg role="${m.role}">${m.content}</msg>`)
    .join('\n')
  return `<conversation_history>\n${history}\n</conversation_history>\n\n${last}`
})
vi.mock('../streaming', async () => {
  const actual = await vi.importActual<typeof import('../streaming')>('../streaming')
  return { ...actual, buildPromptWithHistory: (...args: unknown[]) => mockBuildPromptWithHistory(...args as Parameters<typeof mockBuildPromptWithHistory>) }
})

import { buildPrompt } from './buildPrompt'

describe('buildPrompt — slash command detection', () => {
  it('returns the last message verbatim when it is a slash command', () => {
    const messages = [{ role: 'user' as const, content: '/compact' }]
    expect(buildPrompt(messages, 'sys')).toBe('/compact')
  })

  it('returns the command with arguments verbatim', () => {
    const messages = [{ role: 'user' as const, content: '/clear --all' }]
    expect(buildPrompt(messages, undefined)).toBe('/clear --all')
  })

  it('trims whitespace before slash detection', () => {
    const messages = [{ role: 'user' as const, content: '  /do-thing  ' }]
    expect(buildPrompt(messages, undefined)).toBe('/do-thing')
  })

  it('does NOT bypass buildPromptWithHistory for "//" (not a valid slash command)', () => {
    // /[\w-]+ requires at least one word char after /; // has no word char
    // So "//comment" goes through the normal history path — mockBuildPromptWithHistory is called
    const messages = [{ role: 'user' as const, content: '//comment' }]
    mockBuildPromptWithHistory.mockClear()
    buildPrompt(messages, undefined)
    expect(mockBuildPromptWithHistory).toHaveBeenCalledWith(messages)
  })

  it('does NOT bypass buildPromptWithHistory for "/ " (space after slash)', () => {
    const messages = [{ role: 'user' as const, content: '/ not a command' }]
    mockBuildPromptWithHistory.mockClear()
    buildPrompt(messages, undefined)
    expect(mockBuildPromptWithHistory).toHaveBeenCalledWith(messages)
  })
})

describe('buildPrompt — non-slash with systemPrompt', () => {
  it('wraps historyPrompt with <system_context> prefix', () => {
    const messages = [{ role: 'user' as const, content: 'hello world' }]
    const result = buildPrompt(messages, 'Be helpful.')
    expect(result).toContain('<system_context>')
    expect(result).toContain('Be helpful.')
    expect(result).toContain('</system_context>')
    expect(result).toContain('hello world')
  })

  it('system_context prefix precedes the history prompt', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const result = buildPrompt(messages, 'SYSTEM')
    expect(result.indexOf('<system_context>')).toBeLessThan(result.indexOf('hi'))
  })
})

describe('buildPrompt — non-slash without systemPrompt', () => {
  it('returns pure history prompt when systemPrompt is undefined', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const result = buildPrompt(messages, undefined)
    expect(result).toBe('hi')
    expect(result).not.toContain('<system_context>')
  })

  it('returns pure history prompt when systemPrompt is empty string', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const result = buildPrompt(messages, '')
    // empty string is falsy — treated same as undefined
    expect(result).not.toContain('<system_context>')
  })

  it('includes conversation history in result', () => {
    const messages = [
      { role: 'user' as const, content: 'first' },
      { role: 'assistant' as const, content: 'second' },
      { role: 'user' as const, content: 'third' },
    ]
    const result = buildPrompt(messages, undefined)
    expect(result).toContain('<conversation_history>')
    expect(result).toContain('third')
  })
})
