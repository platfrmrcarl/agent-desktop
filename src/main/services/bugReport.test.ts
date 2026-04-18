import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockFetch(...args) },
  app: { getVersion: () => '0.13.0' },
}))

import { sendBugReport, buildEmbed, resetRateLimitForTest } from './bugReport'

describe('buildEmbed', () => {
  it('includes all metadata fields', () => {
    const embed = buildEmbed({
      description: 'It crashed',
      logs: 'log content',
      metadata: {
        version: '0.13.0',
        platform: 'linux (x64)',
        session: 'Wayland',
        electron: '33.2.1',
        node: '20.18.1',
        aiBackend: 'claude-agent-sdk',
        theme: 'dark',
        webMode: 'no',
      },
    })
    const names = embed.fields.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining(['Version', 'Platform', 'Session', 'Electron', 'Node', 'AI Backend', 'Theme', 'Web mode']),
    )
    expect(embed.description).toBe('It crashed')
  })

  it('uses placeholder description when empty', () => {
    const embed = buildEmbed({
      description: '',
      logs: 'log',
      metadata: defaultMeta(),
    })
    expect(embed.description).toBe('_No description provided_')
  })

  it('references the attached log file when logs are present', () => {
    const embed = buildEmbed({
      description: 'crash',
      logs: 'many lines of logs here',
      metadata: defaultMeta(),
    })
    const logField = embed.fields.find((f) => f.name === 'Logs')
    expect(logField).toBeDefined()
    expect(logField!.value).toContain('logs.txt')
    expect(logField!.value).toContain('23 chars')
  })

  it('shows no-logs placeholder when logs are empty', () => {
    const embed = buildEmbed({ description: 'crash', logs: '', metadata: defaultMeta() })
    const logField = embed.fields.find((f) => f.name === 'Logs')
    expect(logField!.value).toBe('_No logs captured_')
  })

  it('truncates description past 4000 chars with a marker', () => {
    const huge = 'x'.repeat(5000)
    const embed = buildEmbed({ description: huge, logs: 'l', metadata: defaultMeta() })
    expect(embed.description.length).toBeLessThanOrEqual(4000)
    expect(embed.description).toContain('[truncated]')
  })
})

describe('sendBugReport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    mockFetch.mockReset()
    resetRateLimitForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns not_configured when webhook url is empty', async () => {
    const res = await sendBugReport({ description: 'x', logs: '', metadata: defaultMeta() }, '')
    expect(res).toEqual({ ok: false, error: 'not_configured' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts multipart/form-data with embed + log attachment and returns ok on 204', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'log content here', metadata: defaultMeta() },
      'https://discord.example/webhook',
    )
    expect(res).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://discord.example/webhook')
    expect((init as RequestInit).method).toBe('POST')
    const body = (init as RequestInit).body
    expect(body).toBeInstanceOf(FormData)
    const form = body as FormData
    const payloadJson = form.get('payload_json') as string
    expect(payloadJson).toBeTypeOf('string')
    const parsed = JSON.parse(payloadJson)
    expect(parsed.embeds).toHaveLength(1)
    const file = form.get('files[0]') as File | Blob | null
    expect(file).not.toBeNull()
  })

  it('omits the log attachment when logs are empty', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response)
    await sendBugReport(
      { description: 'd', logs: '   ', metadata: defaultMeta() },
      'https://x',
    )
    const [, init] = mockFetch.mock.calls[0]
    const form = (init as RequestInit).body as FormData
    expect(form.get('files[0]')).toBeNull()
    expect(form.get('payload_json')).toBeTypeOf('string')
  })

  it('returns server_error on 5xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'server_error' })
  })

  it('returns invalid_webhook on 4xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'invalid_webhook' })
  })

  it('maps 429 to server_error (Discord rate-limiting, not bad URL)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'server_error' })
  })

  it('does not set Content-Type header (fetch sets multipart boundary itself)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response)
    await sendBugReport({ description: 'd', logs: 'l', metadata: defaultMeta() }, 'https://x')
    const [, init] = mockFetch.mock.calls[0]
    expect((init as RequestInit).headers).toBeUndefined()
  })

  it('returns timeout when fetch throws AbortError', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    mockFetch.mockRejectedValueOnce(err)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'timeout' })
  })

  it('rate-limits second rapid call', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response)
    await sendBugReport({ description: 'd', logs: 'l', metadata: defaultMeta() }, 'https://x')
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res.ok).toBe(false)
    expect(res.error).toBe('rate_limited')
    expect(res.retryAfterMs).toBeGreaterThan(0)
    expect(res.retryAfterMs).toBeLessThanOrEqual(30_000)
  })

  it('allows second call after 30s cooldown', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response)
    await sendBugReport({ description: 'd', logs: 'l', metadata: defaultMeta() }, 'https://x')
    vi.setSystemTime(new Date('2026-04-18T10:00:31.000Z'))
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: true })
  })
})

function defaultMeta() {
  return {
    version: '0.13.0',
    platform: 'linux (x64)',
    session: 'Wayland' as const,
    electron: '33.2.1',
    node: '20.18.1',
    aiBackend: 'claude-agent-sdk',
    theme: 'dark',
    webMode: 'no' as const,
  }
}
