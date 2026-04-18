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
const MAX_EMBED_TOTAL = 6000
const MAX_FIELD_VALUE = 1024
const MAX_DESCRIPTION = 4000
const LOG_CODEFENCE_OVERHEAD = 10

let lastSentAtMs = 0

export function resetRateLimitForTest(): void {
  lastSentAtMs = 0
}

function randomUuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as { randomUUID: () => string }).randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const suffix = '\n[truncated]'
  return text.slice(0, max - suffix.length) + suffix
}

function splitLogs(logs: string): DiscordEmbedField[] {
  if (!logs.trim()) {
    return [{ name: 'Logs', value: '```\n<no logs captured>\n```', inline: false }]
  }
  const chunkSize = MAX_FIELD_VALUE - LOG_CODEFENCE_OVERHEAD
  const chunks: string[] = []
  for (let i = 0; i < logs.length; i += chunkSize) {
    chunks.push(logs.slice(i, i + chunkSize))
  }
  const total = chunks.length
  return chunks.map((c, i) => ({
    name: total === 1 ? 'Logs' : `Logs (${i + 1}/${total})`,
    value: '```\n' + c + '\n```',
    inline: false,
  }))
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
  const description = payload.description.trim()
    ? truncate(payload.description, MAX_DESCRIPTION)
    : '_No description provided_'

  const logFields = splitLogs(payload.logs)
  let fields = [...metaFields, ...logFields]

  let embed: DiscordEmbed = {
    title: 'Bug Report',
    color: 15158332,
    timestamp: new Date().toISOString(),
    description,
    fields,
    footer: { text: `Report ID: ${randomUuid()}` },
  }

  while (JSON.stringify(embed).length > MAX_EMBED_TOTAL && fields.length > metaFields.length) {
    const dropped = fields.length - metaFields.length
    fields = fields.slice(0, -1)
    const last = fields[fields.length - 1]
    if (last && last.name.startsWith('Logs')) {
      last.value = last.value.replace(/\n```$/, `\n[truncated, ${dropped} chunk(s) omitted]\n\`\`\``)
    }
    embed = { ...embed, fields }
  }

  return embed
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
  const body = JSON.stringify({
    username: 'Agent Desktop Bug Reporter',
    embeds: [embed],
  })

  try {
    const res = await net.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) {
      lastSentAtMs = Date.now()
      return { ok: true }
    }
    if (res.status >= 500) return { ok: false, error: 'server_error' }
    if (res.status >= 400) return { ok: false, error: 'invalid_webhook' }
    return { ok: false, error: 'unknown' }
  } catch (err) {
    const name = (err as Error).name
    if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'unknown' }
  }
}
