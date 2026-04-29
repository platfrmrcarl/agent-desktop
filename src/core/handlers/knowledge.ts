import type { HandleRegistrar } from '../dispatch'
import type { KnowledgeCollection } from '../types/types'
import { join, extname, relative } from 'path'
import { promises as fsp } from 'fs'
import { validateString } from '../utils/validate'

// ─── Constants ──────────────────────────────────────────────

const MAX_DEPTH = 10
const MAX_FILES = 1000

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.yaml', '.yml',
])

// ─── Internals ──────────────────────────────────────────────

export async function findSupportedFiles(dirPath: string): Promise<{ name: string; path: string; size: number }[]> {
  const results: { name: string; path: string; size: number }[] = []
  const fileCount = { value: 0 }

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth >= MAX_DEPTH || fileCount.value >= MAX_FILES) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const textFiles: string[] = []
    const subdirs: string[] = []

    for (const entry of entries) {
      if (fileCount.value >= MAX_FILES) break
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      } else if (TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        textFiles.push(fullPath)
      }
    }

    // Batch stat calls for text files
    const statResults = await Promise.all(
      textFiles.map(async (fullPath) => {
        try {
          const stat = await fsp.stat(fullPath)
          return { path: fullPath, name: relative(dirPath, fullPath), size: stat.size }
        } catch {
          return null
        }
      })
    )
    for (const r of statResults) {
      if (r && fileCount.value < MAX_FILES) {
        results.push(r)
        fileCount.value++
      }
    }

    // Recurse into subdirectories
    for (const subdir of subdirs) {
      if (fileCount.value >= MAX_FILES) break
      await scan(subdir, depth + 1)
    }
  }

  await scan(dirPath, 0)
  return results
}

async function scanCollection(collectionPath: string, collectionName: string): Promise<KnowledgeCollection> {
  const files = await findSupportedFiles(collectionPath)
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return {
    name: collectionName,
    path: collectionPath,
    fileCount: files.length,
    totalSize,
  }
}

// ─── Handler registration ───────────────────────────────────

export function registerKnowledgeHandlers(registrar: HandleRegistrar, knowledgesDir: string): void {
  registrar.handle('kb:listCollections', async () => {
    await fsp.mkdir(knowledgesDir, { recursive: true })
    const entries = await fsp.readdir(knowledgesDir, { withFileTypes: true })
    const dirEntries = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))
    const collections = await Promise.all(
      dirEntries.map(entry => scanCollection(join(knowledgesDir, entry.name), entry.name))
    )
    return collections
  })

  registrar.handle('kb:getCollectionFiles', async (_event, collectionName: unknown) => {
    const name = validateString(collectionName, 'collectionName', 500)
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid collection name')
    }
    const collectionPath = join(knowledgesDir, name)
    return findSupportedFiles(collectionPath)
  })
}
