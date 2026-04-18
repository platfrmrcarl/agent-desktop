import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ErrorBuffer } from '../services/errorBuffer'
import { DispatchRegistry } from '../dispatch'

vi.mock('../../main/services/bugReport', () => ({
  sendBugReport: vi.fn(),
}))
vi.mock('../../main/services/logScrubber', () => ({
  scrub: (s: string) => s.replace('/home/alice', '~'),
}))

import { sendBugReport } from '../../main/services/bugReport'
import { registerBugReportHandlers } from './bugReport'

const mockedSend = sendBugReport as unknown as ReturnType<typeof vi.fn>

describe('bugReport handlers', () => {
  beforeEach(() => {
    mockedSend.mockReset()
  })

  it('bug:getMainErrors returns buffer contents', async () => {
    const buf = new ErrorBuffer()
    buf.push({
      timestamp: '2026-04-18T10:00:00.000Z',
      source: 'main',
      level: 'error',
      message: 'boom',
    })
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: buf,
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const result = await reg.get('bug:getMainErrors')!()
    expect(result).toHaveLength(1)
  })

  it('bug:getMainErrors returns [] if buffer throws', async () => {
    const buf = { getAll: () => { throw new Error('bad') } } as unknown as ErrorBuffer
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: buf,
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const result = await reg.get('bug:getMainErrors')!()
    expect(result).toEqual([])
  })

  it('bug:scrub applies scrubber to input string', async () => {
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const out = await reg.get('bug:scrub')!('/home/alice/x')
    expect(out).toBe('~/x')
  })

  it('bug:send delegates to sendBugReport with metadata + url', async () => {
    mockedSend.mockResolvedValueOnce({ ok: true })
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => 'https://x',
    })
    const res = await reg.get('bug:send')!({ description: 'd', logs: 'l' })
    expect(res).toEqual({ ok: true })
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'd', logs: 'l' }),
      'https://x',
    )
  })

  it('bug:send returns { ok:false, error:unknown } when send throws', async () => {
    mockedSend.mockRejectedValueOnce(new Error('unexpected'))
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => 'https://x',
    })
    const res = await reg.get('bug:send')!({ description: 'd', logs: 'l' })
    expect(res).toEqual({ ok: false, error: 'unknown' })
  })
})

function metaFixture() {
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
