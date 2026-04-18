import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer, type ErrorEntry } from '../../core/services/errorBuffer'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}))

import { readFile, writeFile, rename, unlink } from 'fs/promises'
import { loadFromDisk, attachPersistence } from './errorBufferPersist'

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>
const mockedWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>
const mockedRename = rename as unknown as ReturnType<typeof vi.fn>
const mockedUnlink = unlink as unknown as ReturnType<typeof vi.fn>

const entry: ErrorEntry = {
  timestamp: '2026-04-18T10:00:00.000Z',
  source: 'main',
  level: 'error',
  message: 'hello',
}

describe('errorBufferPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    mockedReadFile.mockReset()
    mockedWriteFile.mockReset()
    mockedRename.mockReset()
    mockedUnlink.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('loadFromDisk', () => {
    it('hydrates buffer from valid file', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([entry]))
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(buf.getAll()).toHaveLength(1)
    })

    it('starts empty when file is missing', async () => {
      mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('enoent'), { code: 'ENOENT' }))
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(buf.getAll()).toEqual([])
    })

    it('deletes corrupt file and starts empty', async () => {
      mockedReadFile.mockResolvedValueOnce('{not json')
      mockedUnlink.mockResolvedValueOnce(undefined)
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(mockedUnlink).toHaveBeenCalledWith('/fake/path.json')
      expect(buf.getAll()).toEqual([])
    })
  })

  describe('attachPersistence', () => {
    it('writes atomically (temp + rename) after debounce', async () => {
      mockedWriteFile.mockResolvedValue(undefined)
      mockedRename.mockResolvedValue(undefined)
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      expect(mockedWriteFile).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockedWriteFile).toHaveBeenCalledTimes(1)
      const [tmpPath, payload] = mockedWriteFile.mock.calls[0]
      expect(tmpPath).toBe('/fake/path.json.tmp')
      expect(JSON.parse(payload as string)).toHaveLength(1)
      expect(mockedRename).toHaveBeenCalledWith('/fake/path.json.tmp', '/fake/path.json')
    })

    it('coalesces bursts into a single write', async () => {
      mockedWriteFile.mockResolvedValue(undefined)
      mockedRename.mockResolvedValue(undefined)
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      buf.push(entry)
      buf.push(entry)
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    })

    it('swallows I/O errors silently', async () => {
      mockedWriteFile.mockRejectedValue(new Error('disk full'))
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      await expect(vi.advanceTimersByTimeAsync(2000)).resolves.not.toThrow()
    })
  })
})
