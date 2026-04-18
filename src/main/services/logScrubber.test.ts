import { describe, it, expect } from 'vitest'
import { scrub } from './logScrubber'

describe('logScrubber', () => {
  it('replaces linux home dir paths with ~', () => {
    expect(scrub('error at /home/alice/project/file.ts')).toBe('error at ~/project/file.ts')
  })

  it('replaces windows user paths with ~', () => {
    expect(scrub('error at C:\\Users\\Bob\\app.exe')).toBe('error at C:\\Users\\~\\app.exe')
  })

  it('replaces email addresses with <email>', () => {
    expect(scrub('contact alice@example.com for support')).toBe('contact <email> for support')
  })

  it('replaces openai-style keys with <redacted-key>', () => {
    expect(scrub('Authorization: sk-abcdefghijklmnopqrstuv')).toBe('Authorization: <redacted-key>')
  })

  it('replaces github tokens with <redacted-key>', () => {
    expect(scrub('token ghp_abcdefghijklmnopqrst')).toBe('token <redacted-key>')
  })

  it('replaces slack tokens with <redacted-key>', () => {
    expect(scrub('slack xoxb-1234567890-abcdef')).toBe('slack <redacted-key>')
  })

  it('replaces bearer tokens', () => {
    expect(scrub('Authorization: Bearer abcdef1234567890abcdef12'))
      .toBe('Authorization: Bearer <redacted>')
  })

  it('applies multiple rules sequentially', () => {
    const input = 'user alice@example.com at /home/alice/secrets with Bearer abcdef1234567890abcdef12'
    const out = scrub(input)
    expect(out).toContain('<email>')
    expect(out).toContain('~/secrets')
    expect(out).toContain('Bearer <redacted>')
    expect(out).not.toContain('alice@example.com')
    expect(out).not.toContain('/home/alice')
  })

  it('does not mutate innocent text', () => {
    const clean = 'normal log line with no secrets'
    expect(scrub(clean)).toBe(clean)
  })

  it('handles empty string', () => {
    expect(scrub('')).toBe('')
  })
})
