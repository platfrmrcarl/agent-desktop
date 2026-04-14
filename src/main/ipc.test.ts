import { vi } from 'vitest'

// --- Mocks (must be before imports that trigger service module loading) ---

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/test-agent'),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    show: vi.fn(),
    on: vi.fn(),
    webContents: { send: vi.fn(), once: vi.fn() },
    isDestroyed: vi.fn(() => false),
  })),
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn(), on: vi.fn() })),
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn() },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
    autoDownload: false,
    autoInstallOnAppQuit: false,
  },
}))

vi.mock('ws', () => ({
  WebSocketServer: vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
    clients: new Set(),
  })),
  WebSocket: { OPEN: 1 },
}))

vi.mock('./index', () => ({
  getMainWindow: vi.fn(() => null),
}))

vi.mock('./services/streaming', () => ({
  streamMessage: vi.fn(),
  abortStream: vi.fn(),
  respondToApproval: vi.fn(),
  injectApiKeyEnv: vi.fn(),
  notifyConversationUpdated: vi.fn(),
  registerStreamWindow: vi.fn(),
}))

vi.mock('./services/anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

vi.mock('./services/globalShortcuts', () => ({
  reregister: vi.fn(),
}))

vi.mock('./utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/bin/claude'),
  isAppImage: vi.fn(() => false),
  getSessionType: vi.fn(() => 'x11'),
}))

vi.mock('./utils/volume', () => ({
  duckVolume: vi.fn(),
  restoreVolume: vi.fn(),
}))

vi.mock('./utils/broadcast', () => ({
  broadcast: vi.fn(),
  setBroadcastHandler: vi.fn(),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  }
})

import { createTestDb } from './__tests__/db-helper'
import { createMockIpcMain } from './__tests__/ipc-helper'
import { bridgeDispatchToIpc } from './ipc'
import { AgentEngine } from '../core'
import type { Broadcaster } from '../core/ports/broadcaster'
import { noopHookRunner } from '../core/ports/hookRunner'
import { closeDatabase } from '../core/db/database'
import type Database from 'better-sqlite3'

const noopBroadcaster: Broadcaster = { broadcast: vi.fn() }

describe('bridgeDispatchToIpc', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>
  let engine: AgentEngine

  beforeEach(async () => {
    // Close any previously initialized database singleton
    closeDatabase()

    // Initialize engine with in-memory DB via the standard init path
    engine = new AgentEngine({
      dbPath: '/tmp/test-ipc-bridge.db',
      themesDir: '/tmp/test-themes',
      broadcaster: noopBroadcaster,
      hookRunner: noopHookRunner,
    })
    await engine.init()
    db = engine.db as any

    ipc = createMockIpcMain()
    bridgeDispatchToIpc(engine, ipc as any)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('registers handlers from both core dispatch and Category C services', () => {
    expect(ipc.handle).toHaveBeenCalled()
    // Core dispatch + Category C services should register at least 22 channels
    expect(ipc.handle.mock.calls.length).toBeGreaterThanOrEqual(22)
  })

  it('all expected service channel prefixes are registered', () => {
    const channels = ipc.handle.mock.calls.map((call: unknown[]) => call[0] as string)

    const expectedPrefixes = [
      'auth:',
      'conversations:',
      'messages:',
      'folders:',
      'mcp:',
      'tools:',
      'kb:',
      'files:',
      'attachments:',
      'settings:',
      'shortcuts:',
      'system:',
      'whisper:',
      'openscad:',
      'quickChat:',
      'scheduler:',
      'tts:',
      'themes:',
      'commands:',
      'updates:',
      'jupyter:',
      'server:',
    ]

    for (const prefix of expectedPrefixes) {
      const found = channels.some((ch: string) => ch.startsWith(prefix))
      expect(found, `expected at least one channel with prefix "${prefix}"`).toBe(true)
    }
  })

  it('core dispatch handlers are callable via ipcMain', async () => {
    // Find the settings:get handler registered on ipcMain
    const settingsCall = ipc.handle.mock.calls.find(
      (call: unknown[]) => call[0] === 'settings:get'
    )
    expect(settingsCall).toBeDefined()
    const handler = settingsCall![1] as Function
    // Invoke — should return settings object
    const result = await handler({})
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('wraps handler errors with sanitizeError (strips file paths)', async () => {
    // Call conversations:get via ipcMain with bad ID
    const convCall = ipc.handle.mock.calls.find(
      (call: unknown[]) => call[0] === 'conversations:get'
    )
    expect(convCall).toBeDefined()
    const handler = convCall![1] as Function

    try {
      await handler({}, undefined)
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).not.toMatch(/\/home\//)
      expect(msg).not.toMatch(/\/root\//)
      expect(msg).not.toMatch(/\/Users\//)
    }
  })

  it('engine.dispatch contains core handlers', () => {
    expect(engine.dispatch.has('settings:get')).toBe(true)
    expect(engine.dispatch.has('conversations:list')).toBe(true)
    expect(engine.dispatch.has('folders:list')).toBe(true)
    expect(engine.dispatch.has('auth:getStatus')).toBe(true)
  })
})
