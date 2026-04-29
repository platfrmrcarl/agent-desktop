import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerKnowledgeHandlers, findSupportedFiles } from './knowledge'

const MOCK_KNOWLEDGES_DIR = '/mock-home/.agent-desktop/knowledges'

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn(),
      stat: vi.fn(),
    },
  }
})

describe('knowledge handlers (core)', () => {
  let dispatch: DispatchRegistry

  beforeEach(() => {
    dispatch = new DispatchRegistry()
    registerKnowledgeHandlers(dispatch, MOCK_KNOWLEDGES_DIR)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('kb:listCollections', () => {
    it('returns empty array when no directories exist', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValue([] as any)

      const handler = dispatch.get('kb:listCollections')!
      const collections = await handler()
      expect(collections).toEqual([])
    })

    it('returns collections with fileCount and totalSize', async () => {
      const fs = await import('fs')

      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'my-project', isDirectory: () => true } as any,
        ])
        // Inside the collection folder (findSupportedFiles)
        .mockResolvedValueOnce([
          { name: 'readme.md', isDirectory: () => false } as any,
          { name: 'notes.txt', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 256 } as any)

      const handler = dispatch.get('kb:listCollections')!
      const collections = await handler() as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('my-project')
      expect(collections[0].fileCount).toBe(2)
      expect(collections[0].totalSize).toBe(512)
      expect(collections[0].path).toContain('my-project')
    })

    it('skips hidden directories', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: '.hidden', isDirectory: () => true } as any,
          { name: 'visible', isDirectory: () => true } as any,
        ])
        // readdir for 'visible' collection scan
        .mockResolvedValueOnce([])

      const handler = dispatch.get('kb:listCollections')!
      const collections = await handler() as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('visible')
    })

    it('skips non-directory entries', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'stray-file.txt', isDirectory: () => false } as any,
          { name: 'real-collection', isDirectory: () => true } as any,
        ])
        // readdir for 'real-collection' scan
        .mockResolvedValueOnce([])

      const handler = dispatch.get('kb:listCollections')!
      const collections = await handler() as any[]
      expect(collections).toHaveLength(1)
      expect(collections[0].name).toBe('real-collection')
    })

    it('skips unsupported file extensions', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'collection', isDirectory: () => true } as any,
        ])
        .mockResolvedValueOnce([
          { name: 'photo.png', isDirectory: () => false } as any,
          { name: 'binary.exe', isDirectory: () => false } as any,
          { name: 'valid.ts', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 100 } as any)

      const handler = dispatch.get('kb:listCollections')!
      const collections = await handler() as any[]
      expect(collections[0].fileCount).toBe(1) // only valid.ts
    })
  })

  describe('kb:getCollectionFiles', () => {
    it('returns files in a collection', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: 'file1.md', isDirectory: () => false } as any,
        { name: 'file2.ts', isDirectory: () => false } as any,
      ])
      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 300 } as any)

      const handler = dispatch.get('kb:getCollectionFiles')!
      const files = await handler('my-collection') as any[]
      expect(files).toHaveLength(2)
      expect(files[0].name).toBe('file1.md')
      expect(files[0].size).toBe(300)
      expect(files[1].name).toBe('file2.ts')
    })

    it('throws on directory traversal with ..', async () => {
      const handler = dispatch.get('kb:getCollectionFiles')!
      await expect(handler('../etc')).rejects.toThrow('Invalid collection name')
    })

    it('throws on directory traversal with /', async () => {
      const handler = dispatch.get('kb:getCollectionFiles')!
      await expect(handler('foo/bar')).rejects.toThrow('Invalid collection name')
    })

    it('throws on directory traversal with backslash', async () => {
      const handler = dispatch.get('kb:getCollectionFiles')!
      await expect(handler('foo\\bar')).rejects.toThrow('Invalid collection name')
    })

    it('recursively scans subdirectories', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir)
        .mockResolvedValueOnce([
          { name: 'subdir', isDirectory: () => true } as any,
          { name: 'root.txt', isDirectory: () => false } as any,
        ])
        .mockResolvedValueOnce([
          { name: 'nested.md', isDirectory: () => false } as any,
        ])

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 50 } as any)

      const handler = dispatch.get('kb:getCollectionFiles')!
      const files = await handler('my-collection') as any[]
      expect(files).toHaveLength(2)
    })

    it('skips hidden files in collection', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValueOnce([
        { name: '.gitignore', isDirectory: () => false } as any,
        { name: 'visible.md', isDirectory: () => false } as any,
      ])
      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 50 } as any)

      const handler = dispatch.get('kb:getCollectionFiles')!
      const files = await handler('my-collection') as any[]
      expect(files).toHaveLength(1)
      expect(files[0].name).toBe('visible.md')
    })
  })

  describe('findSupportedFiles (unit)', () => {
    it('returns empty array for empty directory', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValue([] as any)

      const files = await findSupportedFiles('/some/dir')
      expect(files).toEqual([])
    })

    it('skips hidden files', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockResolvedValue([
        { name: '.hidden', isDirectory: () => false } as any,
      ] as any)

      const files = await findSupportedFiles('/some/dir')
      expect(files).toHaveLength(0)
    })

    it('handles readdir error gracefully', async () => {
      const fs = await import('fs')
      vi.mocked(fs.promises.readdir).mockRejectedValue(new Error('ENOENT'))

      const files = await findSupportedFiles('/nonexistent')
      expect(files).toEqual([])
    })
  })
})
