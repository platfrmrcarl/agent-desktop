import { describe, it, expect } from 'vitest'
import { localTokenizer, countJsonTokens, LocalTokenizer } from './tokenCounter'

describe('LocalTokenizer', () => {
  it('returns 0 for empty input', () => {
    expect(localTokenizer.count('')).toBe(0)
  })

  it('counts a known short phrase within a reasonable range', () => {
    const n = localTokenizer.count('hello world')
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBeLessThanOrEqual(4)
  })

  it('scales roughly linearly with content length', () => {
    const short = localTokenizer.count('The quick brown fox jumps over the lazy dog.')
    const long = localTokenizer.count('The quick brown fox jumps over the lazy dog. '.repeat(100))
    expect(long).toBeGreaterThan(short * 50)
  })

  it('handles multibyte Unicode without throwing', () => {
    const n = localTokenizer.count('Salut 👋 mon pote — café ☕ au bistrot')
    expect(n).toBeGreaterThan(0)
  })

  it('is a class that can be instantiated independently', () => {
    const t = new LocalTokenizer()
    expect(t.count('foo')).toBeGreaterThan(0)
  })
})

describe('countJsonTokens', () => {
  it('returns 0 for null / undefined', () => {
    expect(countJsonTokens(null)).toBe(0)
    expect(countJsonTokens(undefined)).toBe(0)
  })

  it('counts a typical MCP tool spec object', () => {
    const spec = {
      name: 'search_files',
      description: 'Search for files by pattern',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob pattern' },
          path: { type: 'string', description: 'root directory' },
        },
        required: ['pattern'],
      },
    }
    const n = countJsonTokens(spec)
    expect(n).toBeGreaterThan(20)
    expect(n).toBeLessThan(200)
  })
})
