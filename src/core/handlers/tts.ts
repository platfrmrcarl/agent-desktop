import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { spawn, spawnSync, execFile } from 'child_process'
import type { ChildProcess } from 'child_process'
import { promises as fsp } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { findBinaryInPath } from '../utils/env'
import { getSetting } from '../utils/db'
import { validateString, validatePositiveInt } from '../utils/validate'
import { HAIKU_MODEL } from '../types/constants'

// ─── Module state ───────────────────────────────────────────

let currentProcess: ChildProcess | null = null
let cachedPlayer: string | null = null
let currentMessageId: number | null = null

// ─── Inline helpers ─────────────────────────────────────────

const PLAYER_NAMES = ['mpv', 'ffplay', 'paplay', 'aplay'] as const

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^-{3,}\s*$/gm, '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function autoDetectPlayer(): string | null {
  if (cachedPlayer) return cachedPlayer
  for (const name of PLAYER_NAMES) {
    const found = findBinaryInPath(name)
    if (found) {
      cachedPlayer = found
      return found
    }
  }
  return null
}

function getPlayerPath(db: any): string | null {
  const configured = getSetting(db, 'tts_playerPath')
  if (configured && configured !== 'auto') {
    const resolved = findBinaryInPath(configured)
    if (resolved) return resolved
    console.warn('[tts] Configured player not found:', configured)
  }
  return autoDetectPlayer()
}

function playAudioFile(filePath: string, db: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const player = getPlayerPath(db)
    if (!player) {
      reject(new Error('No audio player found. Install mpv, ffplay, paplay, or aplay.'))
      return
    }

    const playerName = path.basename(player)
    const args = playerName === 'ffplay'
      ? ['-nodisp', '-autoexit', filePath]
      : [filePath]

    const proc = spawn(player, args, { stdio: 'ignore' })
    currentProcess = proc

    proc.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      if (code !== 0 && code !== null) {
        reject(new Error(`Audio player ${playerName} exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

// ─── Per-stream volume ducking (pactl) ──────────────────────

interface SavedStream {
  index: number
  volume: number
  appName?: string
}

let savedStreams: SavedStream[] | null = null
let duckStreamsPromise: Promise<void> | null = null

function exec(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err)
      else resolve((stdout || '').trim())
    })
  })
}

async function listSinkInputs(pactlPath: string): Promise<SavedStream[]> {
  const out = await exec(pactlPath, ['list', 'sink-inputs'])
  const inputs: SavedStream[] = []
  const blocks = out.split(/^Sink Input #(\d+)/m).slice(1)
  for (let i = 0; i < blocks.length; i += 2) {
    const index = parseInt(blocks[i], 10)
    const body = blocks[i + 1] || ''
    const volMatch = body.match(/Volume:.*?(\d+)%/)
    if (volMatch) {
      const appMatch = body.match(/application\.process\.binary\s*=\s*"([^"]+)"/)
      inputs.push({ index, volume: parseInt(volMatch[1], 10), appName: appMatch?.[1] })
    }
  }
  return inputs
}

function duckOtherStreams(reductionPercent: number): Promise<void> {
  if (reductionPercent <= 0 || savedStreams !== null) return Promise.resolve()

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) return Promise.resolve()

  duckStreamsPromise = (async () => {
    try {
      const inputs = await listSinkInputs(pactlPath)
      if (inputs.length === 0) return

      savedStreams = inputs
      for (const input of inputs) {
        const target = Math.max(0, input.volume - reductionPercent)
        await exec(pactlPath, ['set-sink-input-volume', String(input.index), `${target}%`])
      }
    } catch (err) {
      savedStreams = null
      console.warn('[volume] Duck streams failed:', err)
    }
  })()
  return duckStreamsPromise
}

async function restoreOtherStreams(): Promise<void> {
  if (duckStreamsPromise) {
    await duckStreamsPromise
    duckStreamsPromise = null
  }

  if (!savedStreams) return

  const pactlPath = findBinaryInPath('pactl')
  if (!pactlPath) { savedStreams = null; return }

  const streams = savedStreams
  savedStreams = null

  let currentInputs: SavedStream[] | null = null
  try {
    currentInputs = await listSinkInputs(pactlPath)
  } catch {
    // Fall through to index-only restore
  }

  if (!currentInputs) {
    for (const saved of streams) {
      try {
        await exec(pactlPath, ['set-sink-input-volume', String(saved.index), `${saved.volume}%`])
      } catch { /* stream may have ended */ }
    }
    return
  }

  const currentIndices = new Set(currentInputs.map(s => s.index))
  const matched = new Set<number>()

  for (const saved of streams) {
    if (!currentIndices.has(saved.index)) continue
    try {
      await exec(pactlPath, ['set-sink-input-volume', String(saved.index), `${saved.volume}%`])
      matched.add(saved.index)
    } catch { /* stream ended */ }
  }

  for (const saved of streams) {
    if (matched.has(saved.index) || !saved.appName) continue
    const candidate = currentInputs.find(c => c.appName === saved.appName && !matched.has(c.index))
    if (candidate) {
      try {
        await exec(pactlPath, ['set-sink-input-volume', String(candidate.index), `${saved.volume}%`])
        matched.add(candidate.index)
      } catch { /* stream ended */ }
    }
  }
}

// ─── Provider implementations ───────────────────────────────

async function speakWithPiper(text: string, piperUrl: string, db: any): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `agent-tts-${Date.now()}.wav`)
  try {
    const response = await fetch(piperUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) {
      throw new Error(`Piper returned ${response.status}: ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await fsp.writeFile(tmpFile, buffer)
    await playAudioFile(tmpFile, db)
  } finally {
    await fsp.unlink(tmpFile).catch(() => {})
  }
}

async function speakWithEdgeTts(text: string, voice: string, edgeBinary: string, db: any): Promise<void> {
  const tmpWav = path.join(os.tmpdir(), `agent-tts-${Date.now()}.mp3`)
  const useFile = text.length > 5000
  const tmpTextFile = useFile ? path.join(os.tmpdir(), `agent-tts-text-${Date.now()}.txt`) : null

  try {
    if (tmpTextFile) {
      await fsp.writeFile(tmpTextFile, text, 'utf8')
    }

    await new Promise<void>((resolve, reject) => {
      const args = useFile && tmpTextFile
        ? ['--file', tmpTextFile, '--voice', voice, '--write-media', tmpWav]
        : ['--text', text, '--voice', voice, '--write-media', tmpWav]

      const proc = spawn(edgeBinary, args, { stdio: 'ignore' })
      currentProcess = proc

      proc.on('error', (err) => {
        currentProcess = null
        reject(err)
      })
      proc.on('exit', (code) => {
        if (currentProcess === proc) currentProcess = null
        if (code !== 0) {
          reject(new Error(`edge-tts exited with code ${code}`))
        } else {
          resolve()
        }
      })
    })

    await playAudioFile(tmpWav, db)
  } finally {
    await fsp.unlink(tmpWav).catch(() => {})
    if (tmpTextFile) {
      await fsp.unlink(tmpTextFile).catch(() => {})
    }
  }
}

function speakWithSpdSay(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('spd-say', ['-e', text], { stdio: ['ignore', 'ignore', 'pipe'] })
    currentProcess = proc
    let stderr = ''

    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      if (code !== 0) {
        reject(new Error(`spd-say exited with code ${code}${stderr.trim() ? ': ' + stderr.trim().slice(0, 200) : ''}`))
      } else {
        resolve()
      }
    })
  })
}

function speakWithSay(text: string, voice?: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('say is only available on macOS'))
  }
  return new Promise((resolve, reject) => {
    const args = voice ? ['-v', voice, text] : [text]
    const proc = spawn('say', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    currentProcess = proc
    let stderr = ''

    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
    proc.on('exit', (code) => {
      if (currentProcess === proc) currentProcess = null
      if (code !== 0) {
        reject(new Error(`say exited with code ${code}${stderr.trim() ? ': ' + stderr.trim().slice(0, 200) : ''}`))
      } else {
        resolve()
      }
    })
  })
}

// ─── Core speak/stop ────────────────────────────────────────

function stopInternal(): void {
  if (currentProcess) {
    try {
      currentProcess.kill('SIGTERM')
    } catch {
      // already dead
    }
    currentProcess = null
  }
}

function stop(): void {
  stopInternal()
  currentMessageId = null
}

async function speak(text: string, db: any): Promise<void> {
  stopInternal()

  const provider = getSetting(db, 'tts_provider')
  if (!provider || provider === 'off') return

  const maxLength = parseInt(getSetting(db, 'tts_maxLength') || '2000', 10)
  const stripped = stripMarkdown(text)
  const cleanText = maxLength > 0 ? stripped.slice(0, maxLength) : stripped
  if (!cleanText) return

  const duck = Number(getSetting(db, 'voice_volumeDuck')) || 0
  if (duck > 0) await duckOtherStreams(duck)

  try {
    switch (provider) {
      case 'piper': {
        const piperUrl = getSetting(db, 'tts_piperUrl')
        if (!piperUrl) throw new Error('Piper URL not configured')
        await speakWithPiper(cleanText, piperUrl, db)
        break
      }
      case 'edgetts': {
        const voice = getSetting(db, 'tts_edgettsVoice') || 'en-US-AriaNeural'
        const edgeBinary = getSetting(db, 'tts_edgettsBinary') || 'edge-tts'
        const resolved = findBinaryInPath(edgeBinary)
        if (!resolved) throw new Error(`edge-tts binary not found: ${edgeBinary}`)
        await speakWithEdgeTts(cleanText, voice, resolved, db)
        break
      }
      case 'spd-say': {
        const resolved = findBinaryInPath('spd-say')
        if (!resolved) throw new Error('spd-say binary not found')
        await speakWithSpdSay(cleanText)
        break
      }
      case 'say': {
        if (process.platform !== 'darwin') throw new Error('say is only available on macOS')
        const voice = getSetting(db, 'tts_sayVoice') || undefined
        await speakWithSay(cleanText, voice)
        break
      }
      default:
        throw new Error(`Unknown TTS provider: ${provider}`)
    }
  } finally {
    await restoreOtherStreams().catch(() => {})
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

async function generateSummary(
  content: string,
  db: any,
  aiSettings: { ttsSummaryPrompt?: string; ttsSummaryModel?: string; apiKey?: string; baseUrl?: string }
): Promise<string> {
  const truncatedContent = content.slice(0, 4000)

  const defaultPrompt =
    'Summarize the following AI response in 1-2 concise sentences suitable for text-to-speech. Focus on the key information and actionable points. Respond with ONLY the summary.\n\n{response}'

  const promptTemplate = aiSettings.ttsSummaryPrompt || defaultPrompt
  const prompt = promptTemplate.replace('{response}', truncatedContent)

  // Set up API key env vars
  const apiKey = aiSettings.apiKey || getSetting(db, 'ai_apiKey') || undefined
  const baseUrl = aiSettings.baseUrl || getSetting(db, 'ai_baseUrl') || undefined
  const envBackup: Record<string, string | undefined> = {}

  if (apiKey) {
    envBackup.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = apiKey
  }
  if (baseUrl) {
    envBackup.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL
    process.env.ANTHROPIC_BASE_URL = baseUrl
  }

  try {
    // Dynamic import to avoid hard dependency
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    let summary = ''
    const summaryModel = aiSettings.ttsSummaryModel || HAIKU_MODEL
    const agentQuery = query({
      prompt,
      options: {
        model: summaryModel,
        maxTurns: 1,
        allowDangerouslySkipPermissions: true,
        permissionMode: 'bypassPermissions' as any,
        tools: [],
      },
    })

    for await (const message of agentQuery) {
      const msg = message as {
        type: string
        subtype?: string
        result?: string
        message?: { content?: Array<{ type: string; text?: string }> }
      }
      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text) {
            summary = block.text.trim()
          }
        }
      }
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string' && msg.result.trim()) {
        summary = msg.result.trim()
      }
    }

    if (summary) return summary
    console.warn('[tts] Summary generation returned empty, using truncated original')
    return truncatedContent
  } catch (err) {
    console.warn('[tts] Summary generation failed, using truncated original:', err)
    return truncatedContent
  } finally {
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  }
}

async function speakResponse(
  content: string,
  db: any,
  _conversationId: number,
  aiSettings: { ttsResponseMode?: string; ttsAutoWordLimit?: number; ttsSummaryPrompt?: string; apiKey?: string; baseUrl?: string }
): Promise<void> {
  const mode = aiSettings.ttsResponseMode
  if (!mode || mode === 'off') return

  try {
    if (mode === 'full') {
      await speak(content, db)
    } else if (mode === 'summary') {
      const summary = await generateSummary(content, db, aiSettings)
      await speak(summary, db)
    } else if (mode === 'auto') {
      const wordLimit = aiSettings.ttsAutoWordLimit || 200
      const wordCount = countWords(stripMarkdown(content))
      if (wordCount <= wordLimit) {
        await speak(content, db)
      } else {
        const summary = await generateSummary(content, db, aiSettings)
        await speak(summary, db)
      }
    }
  } catch (err) {
    console.error('[tts] speakResponse failed:', err)
  }
}

async function speakMessage(text: string, db: any, conversationId: number, messageId: number): Promise<void> {
  currentMessageId = messageId
  try {
    // Dynamic import of getAISettings from messages service would create circular dep.
    // In headless mode, retrieve settings directly from DB.
    const settingsRow = (db as any).prepare("SELECT value FROM settings WHERE key = 'tts_responseMode'").get() as { value: string } | undefined
    const aiSettings = {
      ttsResponseMode: settingsRow?.value || 'off',
    }
    await speakResponse(text, db, conversationId, aiSettings)
  } finally {
    currentMessageId = null
  }
}

function validateConfig(
  db: any
): { provider: string; providerFound: boolean; playerFound: boolean; playerPath: string; error?: string } {
  const provider = getSetting(db, 'tts_provider') || 'off'
  let providerFound = false
  let playerFound = false
  let playerPath = ''
  let error: string | undefined

  switch (provider) {
    case 'off':
      providerFound = true
      playerFound = true
      break
    case 'piper': {
      const url = getSetting(db, 'tts_piperUrl')
      providerFound = !!url
      if (!url) error = 'Piper URL not configured'
      const player = getPlayerPath(db)
      playerFound = !!player
      playerPath = player || ''
      if (!player) error = (error ? error + '; ' : '') + 'No audio player found'
      break
    }
    case 'edgetts': {
      const binary = getSetting(db, 'tts_edgettsBinary') || 'edge-tts'
      const resolved = findBinaryInPath(binary)
      providerFound = !!resolved
      if (!resolved) error = `edge-tts binary not found: ${binary}`
      const player = getPlayerPath(db)
      playerFound = !!player
      playerPath = player || ''
      if (!player) error = (error ? error + '; ' : '') + 'No audio player found'
      break
    }
    case 'spd-say': {
      const resolved = findBinaryInPath('spd-say')
      providerFound = !!resolved
      if (!resolved) error = 'spd-say binary not found'
      playerFound = true
      break
    }
    case 'say': {
      if (process.platform !== 'darwin') {
        error = 'say is only available on macOS'
        break
      }
      const resolved = findBinaryInPath('say')
      providerFound = !!resolved
      if (!resolved) error = 'say binary not found (unexpected on macOS)'
      playerFound = true
      playerPath = resolved || '/usr/bin/say'
      break
    }
    default:
      error = `Unknown provider: ${provider}`
  }

  return { provider, providerFound, playerFound, playerPath, error }
}

function detectPlayers(): { name: string; path: string; available: boolean }[] {
  return PLAYER_NAMES.map((name) => {
    const found = findBinaryInPath(name)
    return { name, path: found || '', available: !!found }
  })
}

function listSayVoices(): { name: string; locale: string }[] {
  if (process.platform !== 'darwin') return []
  try {
    const result = spawnSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 5000 })
    if (!result.stdout) return []
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2,})\s+#/)
        if (!match) return null
        return { name: match[1].trim(), locale: match[2] }
      })
      .filter((v): v is { name: string; locale: string } => v !== null)
  } catch {
    return []
  }
}

// ─── Handler registration ───────────────────────────────────

export function registerTtsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  registrar.handle('tts:speak', async (_event, text: unknown) => {
    const validated = validateString(text, 'text', 100_000)
    await speak(validated, db as any)
  })

  registrar.handle('tts:speakMessage', async (_event, text: unknown, conversationId: unknown, messageId: unknown) => {
    const t = validateString(text, 'text', 100_000)
    const cid = validatePositiveInt(conversationId, 'conversationId')
    const mid = validatePositiveInt(messageId, 'messageId')
    await speakMessage(t, db as any, cid, mid)
  })

  registrar.handle('tts:stop', async () => {
    stop()
  })

  registrar.handle('tts:validate', async () => {
    return validateConfig(db as any)
  })

  registrar.handle('tts:detectPlayers', async () => {
    return detectPlayers()
  })

  registrar.handle('tts:listSayVoices', async () => {
    return listSayVoices()
  })
}
