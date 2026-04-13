import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSchedulerLock } from './schedulerLock'

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}))

import { promises as fsp } from 'fs'

const mockReadFile = vi.mocked(fsp.readFile)
const mockWriteFile = vi.mocked(fsp.writeFile)
const mockMkdir = vi.mocked(fsp.mkdir)
const mockUnlink = vi.mocked(fsp.unlink)

const LOCK_PATH = '/tmp/test-scheduler.lock'

describe('createSchedulerLock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue()
    mockUnlink.mockResolvedValue()
  })

  it('acquire() when no lock file exists returns true', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const lock = createSchedulerLock(LOCK_PATH)
    const acquired = await lock.acquire()

    expect(acquired).toBe(true)
    expect(lock.isHeld()).toBe(true)
    expect(mockWriteFile).toHaveBeenCalledWith(
      LOCK_PATH,
      expect.stringMatching(new RegExp(`^${process.pid}\\n\\d{4}-`)),
      'utf-8'
    )
  })

  it('acquire() when lock held by current PID returns true (re-entrant)', async () => {
    mockReadFile.mockResolvedValue(`${process.pid}\n${new Date().toISOString()}`)

    const lock = createSchedulerLock(LOCK_PATH)
    const acquired = await lock.acquire()

    expect(acquired).toBe(true)
    expect(lock.isHeld()).toBe(true)
    // Re-entrant: no need to write a new lock file
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('release() deletes the lock file', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT')) // acquire: no existing lock
    mockReadFile.mockResolvedValueOnce(`${process.pid}\n${new Date().toISOString()}`) // release: read to verify ownership

    const lock = createSchedulerLock(LOCK_PATH)
    await lock.acquire()
    await lock.release()

    expect(mockUnlink).toHaveBeenCalledWith(LOCK_PATH)
    expect(lock.isHeld()).toBe(false)
  })

  it('isHeld() returns false before acquire, true after', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const lock = createSchedulerLock(LOCK_PATH)

    expect(lock.isHeld()).toBe(false)

    await lock.acquire()

    expect(lock.isHeld()).toBe(true)
  })

  it('acquire() when held by dead process returns true (stale lock)', async () => {
    const deadPid = 999999
    mockReadFile.mockResolvedValue(`${deadPid}\n${new Date().toISOString()}`)

    const originalKill = process.kill
    process.kill = vi.fn((pid: number) => {
      if (pid === deadPid) throw new Error('ESRCH')
      return originalKill.call(process, pid)
    }) as typeof process.kill

    try {
      const lock = createSchedulerLock(LOCK_PATH)
      const acquired = await lock.acquire()

      expect(acquired).toBe(true)
      expect(lock.isHeld()).toBe(true)
      expect(mockWriteFile).toHaveBeenCalled()
    } finally {
      process.kill = originalKill
    }
  })

  it('acquire() when held by live process with fresh heartbeat returns false', async () => {
    const otherPid = process.pid + 1
    mockReadFile.mockResolvedValue(`${otherPid}\n${new Date().toISOString()}`)

    const originalKill = process.kill
    process.kill = vi.fn((pid: number, signal?: number) => {
      if (pid === otherPid && (signal === 0 || signal === undefined)) return true
      return originalKill.call(process, pid, signal!)
    }) as typeof process.kill

    try {
      const lock = createSchedulerLock(LOCK_PATH)
      const acquired = await lock.acquire()

      expect(acquired).toBe(false)
      expect(lock.isHeld()).toBe(false)
    } finally {
      process.kill = originalKill
    }
  })

  it('release() is idempotent when not held', async () => {
    const lock = createSchedulerLock(LOCK_PATH)

    // Release without acquire should be a no-op
    await lock.release()

    expect(mockUnlink).not.toHaveBeenCalled()
    expect(lock.isHeld()).toBe(false)
  })
})
