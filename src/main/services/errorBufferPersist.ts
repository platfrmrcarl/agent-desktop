import { readFile, writeFile, rename, unlink } from 'fs/promises'
import type { ErrorBuffer, ErrorEntry } from '../../core/services/errorBuffer'

const FLUSH_DEBOUNCE_MS = 2000

export async function loadFromDisk(buffer: ErrorBuffer, path: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn('[bug-report-internal] read failed, starting empty:', err)
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[bug-report-internal] corrupt persist file, discarding')
    await unlink(path).catch(() => {})
    return
  }
  if (!Array.isArray(parsed)) return
  for (const entry of parsed) {
    if (isErrorEntry(entry)) buffer.push(entry)
  }
}

export function attachPersistence(buffer: ErrorBuffer, path: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = async (): Promise<void> => {
    timer = null
    const tmp = `${path}.tmp`
    const payload = JSON.stringify(buffer.getAll())
    try {
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, path)
    } catch (err) {
      console.warn('[bug-report-internal] flush failed:', err)
    }
  }

  const unsub = buffer.onPush(() => {
    if (timer !== null) return
    timer = setTimeout(() => {
      void flush()
    }, FLUSH_DEBOUNCE_MS)
  })

  return () => {
    unsub()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

function isErrorEntry(value: unknown): value is ErrorEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.timestamp === 'string' &&
    (v.source === 'main' || v.source === 'renderer') &&
    v.level === 'error' &&
    typeof v.message === 'string'
  )
}
