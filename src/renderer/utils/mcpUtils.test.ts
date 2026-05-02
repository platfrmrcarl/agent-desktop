import { describe, it, expect } from 'vitest'
import { parseMcpDisabledList, parseMcpJson } from './mcpUtils'

describe('parseMcpDisabledList', () => {
  it('returns empty array for undefined', () => {
    expect(parseMcpDisabledList(undefined)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseMcpDisabledList('')).toEqual([])
  })

  it('parses valid JSON array of strings', () => {
    expect(parseMcpDisabledList('["server-a","server-b"]')).toEqual(['server-a', 'server-b'])
  })

  it('returns empty array for empty JSON array', () => {
    expect(parseMcpDisabledList('[]')).toEqual([])
  })

  it('returns empty array for non-array JSON', () => {
    expect(parseMcpDisabledList('"just a string"')).toEqual([])
    expect(parseMcpDisabledList('42')).toEqual([])
    expect(parseMcpDisabledList('{"key":"val"}')).toEqual([])
  })

  it('returns empty array for invalid JSON', () => {
    expect(parseMcpDisabledList('not json')).toEqual([])
    expect(parseMcpDisabledList('[')).toEqual([])
  })
})

describe('parseMcpJson', () => {
  it('parses wrapped format (mcpServers)', () => {
    const json = JSON.stringify({
      mcpServers: {
        searxng: {
          command: 'mcp-searxng',
          env: { SEARXNG_URL: 'http://localhost:8080' },
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'searxng',
      type: 'stdio',
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
  })

  it('parses wrapped format with args', () => {
    const json = JSON.stringify({
      mcpServers: {
        myserver: {
          command: 'npx',
          args: ['-y', '@scope/package'],
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@scope/package'],
    })
  })

  it('parses naked format', () => {
    const json = JSON.stringify({
      myserver: {
        command: 'my-mcp',
        env: { API_KEY: 'secret' },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'stdio',
      command: 'my-mcp',
      env: { API_KEY: 'secret' },
    })
  })

  it('parses ultra-naked format (no name)', () => {
    const json = JSON.stringify({
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: '',
      type: 'stdio',
      command: 'mcp-searxng',
      env: { SEARXNG_URL: 'http://localhost:8080' },
    })
  })

  it('parses HTTP server config', () => {
    const json = JSON.stringify({
      mcpServers: {
        remote: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer tok' },
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'remote',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('parses SSE server config', () => {
    const json = JSON.stringify({
      mcpServers: {
        sse: {
          type: 'sse',
          url: 'https://example.com/sse',
        },
      },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'sse',
      type: 'sse',
      url: 'https://example.com/sse',
    })
  })

  it('defaults url without type to http', () => {
    const json = JSON.stringify({
      myserver: { url: 'https://example.com/mcp' },
    })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: 'myserver',
      type: 'http',
      url: 'https://example.com/mcp',
    })
  })

  it('takes first server when multiple present', () => {
    const json = JSON.stringify({
      mcpServers: {
        first: { command: 'cmd-a' },
        second: { command: 'cmd-b' },
      },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.name).toBe('first')
      expect(result.command).toBe('cmd-a')
    }
  })

  it('returns error for invalid JSON', () => {
    expect(parseMcpJson('not json')).toBe('Invalid JSON')
  })

  it('returns error for array', () => {
    expect(parseMcpJson('[]')).toBe('Expected a JSON object')
  })

  it('returns error for empty mcpServers', () => {
    expect(parseMcpJson('{"mcpServers":{}}')).toBe('No server found in mcpServers')
  })

  it('returns error for config with neither command nor url', () => {
    const json = JSON.stringify({ mcpServers: { s: { foo: 'bar' } } })
    expect(parseMcpJson(json)).toBe('Config must have "command" (stdio) or "url" (http/sse)')
  })

  it('returns error for empty object', () => {
    expect(parseMcpJson('{}')).toBe('Empty JSON object')
  })

  // --- additional branch coverage ---

  it('returns error for null JSON value', () => {
    expect(parseMcpJson('null')).toBe('Expected a JSON object')
  })

  it('returns error for string JSON value', () => {
    expect(parseMcpJson('"hello"')).toBe('Expected a JSON object')
  })

  it('returns error for numeric JSON value', () => {
    expect(parseMcpJson('42')).toBe('Expected a JSON object')
  })

  it('returns error for boolean JSON value', () => {
    expect(parseMcpJson('true')).toBe('Expected a JSON object')
  })

  it('returns error when mcpServers is null (treated as naked config)', () => {
    // mcpServers: null fails the object guard, falls to naked format detection,
    // key "mcpServers" is not in CONFIG_KEYS → naked path → val=null → Invalid server config
    expect(parseMcpJson('{"mcpServers":null}')).toBe('Invalid server config')
  })

  it('returns error when mcpServers is a string (treated as naked config)', () => {
    // Same path: mcpServers: "foo" not an object → naked path → val="foo" → Invalid server config
    expect(parseMcpJson('{"mcpServers":"foo"}')).toBe('Invalid server config')
  })

  it('returns error when wrapped server value is null', () => {
    const json = JSON.stringify({ mcpServers: { myserver: null } })
    expect(parseMcpJson(json)).toBe('Invalid server config')
  })

  it('returns error when wrapped server value is an array', () => {
    const json = JSON.stringify({ mcpServers: { myserver: [] } })
    expect(parseMcpJson(json)).toBe('Invalid server config')
  })

  it('returns error when naked first value is null', () => {
    const json = JSON.stringify({ myserver: null })
    expect(parseMcpJson(json)).toBe('Invalid server config')
  })

  it('returns error when naked first value is an array', () => {
    const json = JSON.stringify({ myserver: [] })
    expect(parseMcpJson(json)).toBe('Invalid server config')
  })

  it('ignores non-array args silently (no args field on result)', () => {
    const json = JSON.stringify({
      mcpServers: { s: { command: 'cmd', args: 'not-an-array' } },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.args).toBeUndefined()
      expect(result.command).toBe('cmd')
    }
  })

  it('ignores array env silently (no env field on result)', () => {
    const json = JSON.stringify({
      mcpServers: { s: { command: 'cmd', env: ['not', 'an', 'object'] } },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.env).toBeUndefined()
    }
  })

  it('ignores array headers silently (no headers field on result)', () => {
    const json = JSON.stringify({
      mcpServers: { s: { url: 'https://x.com', headers: ['bad'] } },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.headers).toBeUndefined()
    }
  })

  it('command wins when both command and url are present (ultra-naked)', () => {
    const json = JSON.stringify({ command: 'my-cmd', url: 'https://x.com' })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.type).toBe('stdio')
      expect(result.command).toBe('my-cmd')
      expect(result.url).toBeUndefined()
    }
  })

  it('parses ultra-naked url server without name', () => {
    const json = JSON.stringify({ url: 'https://remote.example.com/mcp' })
    const result = parseMcpJson(json)
    expect(result).toEqual({
      name: '',
      type: 'http',
      url: 'https://remote.example.com/mcp',
    })
  })

  it('explicit type http on wrapped config produces http type', () => {
    const json = JSON.stringify({
      mcpServers: { s: { type: 'http', url: 'https://x.com' } },
    })
    const result = parseMcpJson(json)
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.type).toBe('http')
    }
  })
})
