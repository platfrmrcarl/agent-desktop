import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './system'
import type Database from 'better-sqlite3'

// Mock Electron modules
vi.mock('electron', () => {
  class MockNotification {
    constructor(public options: { title: string; body: string }) {}
    show() {}
  }

  return {
    app: {
      getVersion: () => '1.0.0-test',
      getPath: (name: string) => `/tmp/test-${name}`,
    },
    dialog: {
      showOpenDialog: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
    Notification: MockNotification,
    BrowserWindow: {
      fromWebContents: vi.fn(() => null),
    },
  }
})

describe('System Service', () => {
  let db: Database.Database
  let ipc: ReturnType<typeof createMockIpcMain>

  beforeEach(async () => {
    db = await createTestDb()
    ipc = createMockIpcMain()
    registerHandlers(ipc as any, db)
  })

  afterEach(() => {
    db.close()
    vi.clearAllMocks()
  })

  describe('system:getInfo', () => {
    it('returns system information', async () => {
      const info = await ipc.invoke('system:getInfo')
      expect(info).toEqual({
        version: '1.0.0-test',
        electron: process.versions.electron,
        node: process.versions.node,
        platform: process.platform,
        dbPath: '/tmp/test-userData',
        configPath: '/tmp/test-userData',
        sessionType: expect.stringMatching(/^(wayland|x11|unknown)$/),
      })
    })
  })

  describe('system:openExternal', () => {
    it('opens valid HTTP URL', async () => {
      const { shell } = await import('electron')
      await ipc.invoke('system:openExternal', 'http://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('http://example.com')
    })

    it('opens valid HTTPS URL', async () => {
      const { shell } = await import('electron')
      await ipc.invoke('system:openExternal', 'https://example.com')
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com')
    })

    it('blocks file: protocol', async () => {
      await expect(ipc.invoke('system:openExternal', 'file:///etc/passwd')).rejects.toThrow(
        'Blocked protocol: file:'
      )
    })

    it('blocks javascript: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'javascript:alert(1)')
      ).rejects.toThrow('Blocked protocol: javascript:')
    })

    it('blocks data: protocol', async () => {
      await expect(
        ipc.invoke('system:openExternal', 'data:text/html,<script>alert(1)</script>')
      ).rejects.toThrow('Blocked protocol: data:')
    })

    it('throws on invalid URL format', async () => {
      await expect(ipc.invoke('system:openExternal', 'not-a-url')).rejects.toThrow(
        'Invalid URL format'
      )
    })

    it('throws on non-string URL', async () => {
      await expect(ipc.invoke('system:openExternal', 123 as any)).rejects.toThrow(
        'Invalid URL'
      )
    })

    it('throws on null URL', async () => {
      await expect(ipc.invoke('system:openExternal', null as any)).rejects.toThrow(
        'Invalid URL'
      )
    })
  })

  describe('system:showNotification', () => {
    it('shows notification with valid title and body', async () => {
      await expect(
        ipc.invoke('system:showNotification', 'Test Title', 'Test Body')
      ).resolves.not.toThrow()
    })

    it('throws on non-string title', async () => {
      await expect(
        ipc.invoke('system:showNotification', 123 as any, 'Body')
      ).rejects.toThrow('Notification title and body must be strings')
    })

    it('throws on non-string body', async () => {
      await expect(
        ipc.invoke('system:showNotification', 'Title', 123 as any)
      ).rejects.toThrow('Notification title and body must be strings')
    })

    it('throws on oversized title', async () => {
      const longTitle = 'a'.repeat(501)
      await expect(
        ipc.invoke('system:showNotification', longTitle, 'Body')
      ).rejects.toThrow('Notification title or body exceeds maximum length')
    })

    it('throws on oversized body', async () => {
      const longBody = 'a'.repeat(501)
      await expect(
        ipc.invoke('system:showNotification', 'Title', longBody)
      ).rejects.toThrow('Notification title or body exceeds maximum length')
    })
  })

  describe('system:selectFolder', () => {
    it('returns folder path when user selects one', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/home/user/selected'],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBe('/home/user/selected')
    })

    it('returns null when user cancels', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBeNull()
    })

    it('returns null when no paths selected', async () => {
      const { dialog } = await import('electron')
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: [],
      } as any)

      const result = await ipc.invoke('system:selectFolder')
      expect(result).toBeNull()
    })

    it('passes parent BrowserWindow so the native dialog is sheet-modal (prevents popover click-outside)', async () => {
      const { dialog, BrowserWindow } = await import('electron')
      const mockWindow = { id: 42 } as any
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow)
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      } as any)

      await ipc.invokeWithEvent('system:selectFolder', { sender: {} })

      expect(dialog.showOpenDialog).toHaveBeenCalledWith(mockWindow, expect.objectContaining({
        properties: expect.arrayContaining(['openDirectory']),
      }))
    })
  })

})
