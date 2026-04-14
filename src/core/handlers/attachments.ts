import * as fs from 'fs'
import * as path from 'path'
import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'

const MAX_IMAGE_FILE_SIZE = 100_000_000 // 100MB
const MAX_TEXT_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const IMAGE_EXTENSIONS_DOTTED = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
])

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.js', '.ts', '.py', '.json', '.csv', '.yaml', '.yml',
])

const BLOCKED_PREFIXES = ['/proc', '/sys', '/dev', '/boot', '/sbin', '/etc']

function validatePathSafe(filePath: string): string {
  const resolved = path.resolve(filePath)
  for (const prefix of BLOCKED_PREFIXES) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      throw new Error(`Access denied: ${prefix} is a protected directory`)
    }
  }
  return resolved
}

function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.py': 'text/x-python',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.pdf': 'application/pdf',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

export function registerAttachmentsHandlers(registrar: HandleRegistrar, _db: SqlJsAdapter): void {
  registrar.handle('attachments:readFile', async (_event, filePath: unknown) => {
    validatePathSafe(filePath as string)

    const stats = await fs.promises.stat(filePath as string)
    const ext = path.extname(filePath as string).toLowerCase()
    const name = path.basename(filePath as string)
    const type = getMimeType(ext)
    const size = stats.size

    if (TEXT_EXTENSIONS.has(ext)) {
      if (size > MAX_TEXT_FILE_SIZE) {
        throw new Error(`Text file size exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`)
      }
    } else if (size > MAX_IMAGE_FILE_SIZE) {
      throw new Error('File size exceeds 100MB limit')
    }

    let content: string
    if (IMAGE_EXTENSIONS_DOTTED.has(ext)) {
      content = (await fs.promises.readFile(filePath as string)).toString('base64')
    } else if (TEXT_EXTENSIONS.has(ext)) {
      content = await fs.promises.readFile(filePath as string, 'utf-8')
    } else {
      // PDF and other types: return path only, no content reading
      content = filePath as string
    }

    return { name, content, type, size }
  })

  registrar.handle('attachments:getInfo', async (_event, filePath: unknown) => {
    validatePathSafe(filePath as string)

    const stats = await fs.promises.stat(filePath as string)
    const ext = path.extname(filePath as string).toLowerCase()

    if (TEXT_EXTENSIONS.has(ext)) {
      if (stats.size > MAX_TEXT_FILE_SIZE) {
        throw new Error(`Text file size exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit`)
      }
    } else if (stats.size > MAX_IMAGE_FILE_SIZE) {
      throw new Error('File size exceeds 100MB limit')
    }

    return {
      name: path.basename(filePath as string),
      size: stats.size,
      type: getMimeType(ext),
    }
  })
}
