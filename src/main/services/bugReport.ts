import { net } from 'electron'

export interface BugReportMetadata {
  version: string
  platform: string
  session: 'X11' | 'Wayland' | 'unknown'
  electron: string
  node: string
  aiBackend: string
  theme: string
  webMode: 'yes' | 'no'
}

export interface BugReportPayload {
  description: string
  logs: string
  metadata: BugReportMetadata
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number }

interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title: string
  color: number
  timestamp: string
  description: string
  fields: DiscordEmbedField[]
  footer: { text: string }
}

const RATE_LIMIT_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_DESCRIPTION = 4000
const LOG_FILE_NAME = 'logs.txt'

let lastSentAtMs = 0

export function resetRateLimitForTest(): void {
  lastSentAtMs = 0
}

function randomUuid(): string {
  return crypto.randomUUID()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const suffix = '\n[truncated]'
  return text.slice(0, max - suffix.length) + suffix
}

export function buildEmbed(payload: BugReportPayload): DiscordEmbed {
  const m = payload.metadata
  const metaFields: DiscordEmbedField[] = [
    { name: 'Version', value: m.version, inline: true },
    { name: 'Platform', value: m.platform, inline: true },
    { name: 'Session', value: m.session, inline: true },
    { name: 'Electron', value: m.electron, inline: true },
    { name: 'Node', value: m.node, inline: true },
    { name: 'AI Backend', value: m.aiBackend, inline: true },
    { name: 'Theme', value: m.theme, inline: true },
    { name: 'Web mode', value: m.webMode, inline: true },
  ]
  const trimmed = payload.description.trim()
  const description = trimmed ? truncate(trimmed, MAX_DESCRIPTION) : '_No description provided_'

  const hasLogs = payload.logs.trim().length > 0
  const logField: DiscordEmbedField = hasLogs
    ? {
        name: 'Logs',
        value: `See attached \`${LOG_FILE_NAME}\` (${payload.logs.length} chars)`,
        inline: false,
      }
    : { name: 'Logs', value: '_No logs captured_', inline: false }

  return {
    title: 'Bug Report',
    color: 15158332,
    timestamp: new Date().toISOString(),
    description,
    fields: [...metaFields, logField],
    footer: { text: `Report ID: ${randomUuid()}` },
  }
}

export async function sendBugReport(
  payload: BugReportPayload,
  webhookUrl: string,
): Promise<SendResult> {
  if (!webhookUrl) return { ok: false, error: 'not_configured' }

  const now = Date.now()
  const since = now - lastSentAtMs
  if (since < RATE_LIMIT_MS) {
    return { ok: false, error: 'rate_limited', retryAfterMs: RATE_LIMIT_MS - since }
  }

  const embed = buildEmbed(payload)
  const form = new FormData()
  form.append(
    'payload_json',
    JSON.stringify({
      username: 'Agent Desktop Bug Reporter',
      embeds: [embed],
    }),
  )

  const hasLogs = payload.logs.trim().length > 0
  if (hasLogs) {
    form.append('files[0]', new Blob([payload.logs], { type: 'text/plain' }), LOG_FILE_NAME)
  }

  try {
    // net.fetch sets multipart/form-data Content-Type with boundary automatically
    // when given a FormData body — don't set it manually.
    const res = await net.fetch(webhookUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) {
      lastSentAtMs = Date.now()
      return { ok: true }
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, error: 'server_error' }
    if (res.status >= 400) return { ok: false, error: 'invalid_webhook' }
    return { ok: false, error: 'unknown' }
  } catch (err) {
    const name = (err as Error).name
    if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'unknown' }
  }
}
