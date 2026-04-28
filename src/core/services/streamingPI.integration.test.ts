import { describe, it, expect, vi, beforeEach } from 'vitest'

// Electron is not available in Node test env — mock the minimum needed for module-load-time
// calls in knowledge.ts / messages.ts (app.getPath) and streamingPI.ts (app.isPackaged).
// This does NOT mock the PI SDK itself: when credentials are present the real SDK runs.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => (name === 'home' ? process.env.HOME ?? '/tmp' : '/tmp'),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

vi.mock('./piUIContext', () => ({
  PiUIContext: function PiUIContext() {
    this.dispose = vi.fn()
    this.handleResponse = vi.fn()
  },
}))

vi.mock('./piUIRegistry', () => ({
  registerPiUIContext: vi.fn(),
  unregisterPiUIContext: vi.fn(),
  getActivePiUIContexts: vi.fn(() => [].values()),
}))

import { streamMessagePI } from './streamingPI'
import { setChunkSender } from './streaming'
import type { AISettings } from './streaming'

// This suite exercises real PI SDK code paths. It is intentionally permissive
// about the agent's final response (we don't assert content) — only that the
// bundled Phase 0 no-op extension loads without throwing, and that the turn
// completes with a 'done' chunk.
//
// Skip the suite when no credentials are available. The goal is "does the
// wiring not explode?", not "does the model answer correctly".
const hasCredentials =
  !!process.env.ANTHROPIC_API_KEY ||
  !!process.env.CI_PI_TEST  // opt-in for CI runs against OAuth

const maybeDescribe = hasCredentials ? describe : describe.skip

maybeDescribe('streamingPI + bundled agent-desktop-parity extension (integration)', () => {
  let capturedChunks: Array<{ type: string; content?: string; extra: Record<string, unknown> }>

  beforeEach(() => {
    capturedChunks = []
    setChunkSender((channel, payload) => {
      if (channel === 'messages:stream') {
        const { type, content, ...extra } = payload as { type: string; content?: string } & Record<string, unknown>
        capturedChunks.push({ type, content, extra })
      }
    })
  })

  it('loads the bundled extension and completes a trivial turn with a done chunk', async () => {
    const aiSettings: AISettings = {
      sdkBackend: 'pi',
      cwd: process.cwd(),
      model: 'claude-haiku-4-5-20251001',
      apiKey: process.env.ANTHROPIC_API_KEY,
    } as AISettings

    const result = await streamMessagePI(
      [{ role: 'user', content: 'Say exactly: OK' }],
      undefined,
      aiSettings,
      9999,
    )

    expect(result.aborted).toBe(false)
    expect(capturedChunks.some(c => c.type === 'done')).toBe(true)

    // The Phase 0 no-op factory emits nothing of its own.
    // Any system_message from our extension modules would have hookName starting with a known prefix.
    const fromExtension = capturedChunks.filter(
      c => c.type === 'system_message' && typeof c.extra.hookName === 'string'
            && (c.extra.hookName as string).startsWith('cwd-guard'),
    )
    expect(fromExtension).toHaveLength(0)
  }, 60_000)

  it('does not throw when aiSettings.piExtensionsDir is undefined', async () => {
    const aiSettings: AISettings = {
      sdkBackend: 'pi',
      cwd: process.cwd(),
      model: 'claude-haiku-4-5-20251001',
      apiKey: process.env.ANTHROPIC_API_KEY,
    } as AISettings

    const result = await streamMessagePI(
      [{ role: 'user', content: 'ping' }],
      undefined,
      aiSettings,
      undefined,
    )
    expect(typeof result.aborted).toBe('boolean')
  }, 60_000)
})
