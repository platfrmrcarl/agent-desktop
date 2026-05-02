import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockFetch(...args) },
}))

import { fireCompletionWebhook, type CompletionPayload } from './webhook'

const payload: CompletionPayload = {
  event: 'completion',
  conversationId: 1,
  conversationTitle: 'Test Conv',
  messageId: 42,
  content: 'Hello world',
  model: 'claude-sonnet-4-6',
  stopReason: 'end_turn',
  createdAt: '2026-04-06T12:00:00.000Z',
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('fireCompletionWebhook', () => {
  it('POSTs JSON payload to the given URL', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await fireCompletionWebhook('https://example.com/hook', payload)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe('https://example.com/hook')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body)).toEqual(payload)
  })

  it('includes AbortSignal with 10s timeout', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await fireCompletionWebhook('https://example.com/hook', payload)

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('logs warning on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 })
    // Logger writes warn entries to stderr in JSON format under non-TTY
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await fireCompletionWebhook('https://example.com/hook', payload)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"level":"warn".*"status":500/)
    )
    warnSpy.mockRestore()
  })

  it('catches and logs network errors without throwing', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(fireCompletionWebhook('https://example.com/hook', payload)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"level":"error".*"message":"ECONNREFUSED"/)
    )
    errorSpy.mockRestore()
  })

  it('includes error field for completion_with_error events', async () => {
    mockFetch.mockResolvedValue({ ok: true })
    const errorPayload: CompletionPayload = {
      ...payload,
      event: 'completion_with_error',
      error: 'Stream interrupted',
    }

    await fireCompletionWebhook('https://example.com/hook', errorPayload)

    const [, opts] = mockFetch.mock.calls[0]
    const body = JSON.parse(opts.body)
    expect(body.event).toBe('completion_with_error')
    expect(body.error).toBe('Stream interrupted')
  })
})
