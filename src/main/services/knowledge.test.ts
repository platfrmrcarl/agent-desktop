import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../__tests__/db-helper'
import { createMockIpcMain } from '../__tests__/ipc-helper'
import { registerHandlers } from './knowledge'
import type Database from 'better-sqlite3'

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock-home'),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
}))

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
    },
  }
})

describe('Knowledge Service (Electron-only handlers)', () => {
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

  describe('kb:openKnowledgesFolder', () => {
    it('calls shell.showItemInFolder with knowledges directory', async () => {
      const { shell } = await import('electron')

      await ipc.invoke('kb:openKnowledgesFolder')

      expect(shell.showItemInFolder).toHaveBeenCalledTimes(1)
      const calledPath = vi.mocked(shell.showItemInFolder).mock.calls[0][0]
      expect(calledPath).toContain('knowledges')
    })

    it('ensures directory exists before opening', async () => {
      const fs = await import('fs')

      await ipc.invoke('kb:openKnowledgesFolder')

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('knowledges'),
        { recursive: true }
      )
    })
  })
})
