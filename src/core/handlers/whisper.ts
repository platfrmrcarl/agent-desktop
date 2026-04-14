import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { transcribe, validateConfig } from '../services/whisper'
import { getSetting } from '../utils/db'
import { findBinaryInPath } from '../utils/env'
import { execFile } from 'child_process'

// ─── Volume duck/restore (inline — avoids importing from main/utils) ────

interface BackendInfo {
  name: 'wpctl' | 'pactl' | 'amixer'
  path: string
}

let cachedBackend: BackendInfo | null | undefined = undefined
let savedVolume: number | null = null
let duckPromise: Promise<void> | null = null

function detectBackend(): BackendInfo | null {
  if (cachedBackend !== undefined) return cachedBackend
  for (const name of ['wpctl', 'pactl', 'amixer'] as const) {
    const p = findBinaryInPath(name)
    if (p) {
      cachedBackend = { name, path: p }
      return cachedBackend
    }
  }
  cachedBackend = null
  return null
}

function exec(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve((stdout || '').trim())
    })
  })
}

async function getVolume(backend: BackendInfo): Promise<number> {
  switch (backend.name) {
    case 'wpctl': {
      const out = await exec(backend.path, ['get-volume', '@DEFAULT_AUDIO_SINK@'])
      const match = out.match(/Volume:\s+(\d+\.?\d*)/)
      if (!match) throw new Error(`wpctl: unexpected output: ${out}`)
      return Math.round(parseFloat(match[1]) * 100)
    }
    case 'pactl': {
      const out = await exec(backend.path, ['get-sink-volume', '@DEFAULT_SINK@'])
      const match = out.match(/(\d+)%/)
      if (!match) throw new Error(`pactl: unexpected output: ${out}`)
      return parseInt(match[1], 10)
    }
    case 'amixer': {
      const out = await exec(backend.path, ['get', 'Master'])
      const match = out.match(/\[(\d+)%\]/)
      if (!match) throw new Error(`amixer: unexpected output: ${out}`)
      return parseInt(match[1], 10)
    }
  }
}

async function setVolume(backend: BackendInfo, percent: number): Promise<void> {
  switch (backend.name) {
    case 'wpctl':
      await exec(backend.path, ['set-volume', '@DEFAULT_AUDIO_SINK@', String(percent / 100)])
      break
    case 'pactl':
      await exec(backend.path, ['set-sink-volume', '@DEFAULT_SINK@', `${percent}%`])
      break
    case 'amixer':
      await exec(backend.path, ['set', 'Master', `${percent}%`])
      break
  }
}

function duckVolume(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedVolume !== null) return Promise.resolve()

  const backend = detectBackend()
  if (!backend) return Promise.resolve()

  duckPromise = (async () => {
    try {
      const current = await getVolume(backend)
      savedVolume = current
      const target = Math.max(0, current - reductionPercent)
      await setVolume(backend, target)
    } catch (err) {
      savedVolume = null
      console.warn('[volume] Duck failed:', err)
    }
  })()
  return duckPromise
}

async function restoreVolume(): Promise<void> {
  if (duckPromise) {
    await duckPromise
    duckPromise = null
  }

  if (savedVolume === null) return

  const backend = detectBackend()
  if (!backend) return

  const vol = savedVolume
  savedVolume = null

  try {
    await setVolume(backend, vol)
  } catch (err) {
    console.warn('[volume] Restore failed:', err)
  }
}

// ─── Handler registration ───────────────────────────────────

export function registerWhisperHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('whisper:transcribe', async (_event, wavBuffer: unknown) => {
    const raw = wavBuffer as Uint8Array | Buffer
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    return transcribe(db as any, buf)
  })

  registrar.handle('whisper:validateConfig', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('voice:duck', async () => {
    const duck = Number(getSetting(db as any, 'voice_volumeDuck')) || 0
    if (duck > 0) await duckVolume(duck)
  })

  registrar.handle('voice:restore', async () => {
    await restoreVolume()
  })
}
