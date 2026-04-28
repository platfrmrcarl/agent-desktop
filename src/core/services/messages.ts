import type Database from 'better-sqlite3'
import { promises as fsp } from 'fs'
import { join, basename, extname } from 'path'
import { safeJsonParse } from '../utils/json'
import type { Message, Attachment, ToolCall } from '../types'

export class MessageService {
  constructor(private db: Database.Database) {}

  buildHistory(conversationId: number, limit = 100): Array<{ role: 'user' | 'assistant'; content: string }> {
    const conv = this.db.prepare('SELECT cleared_at, compact_summary FROM conversations WHERE id = ?').get(conversationId) as { cleared_at: string | null; compact_summary: string | null } | undefined

    let query = 'SELECT role, content FROM messages WHERE conversation_id = ?'
    const params: (number | string)[] = [conversationId]

    if (conv?.cleared_at) {
      query += ' AND created_at > ?'
      params.push(conv.cleared_at)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const rows = this.db.prepare(query).all(...params) as Pick<Message, 'role' | 'content'>[]

    const result = rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }))

    if (conv?.compact_summary) {
      result.unshift({ role: 'assistant', content: `[Previous conversation summary]\n${conv.compact_summary}` })
    }

    return result
  }

  save(
    conversationId: number,
    role: 'user' | 'assistant',
    content: string,
    attachments: Attachment[] = [],
    toolCalls?: ToolCall[]
  ): Message {
    const now = new Date().toISOString()
    const toolCallsJson = toolCalls?.length ? JSON.stringify(toolCalls) : null
    const result = this.db
      .prepare(
        `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(conversationId, role, content, JSON.stringify(attachments), toolCallsJson, now, now)

    return {
      id: result.lastInsertRowid as number,
      conversation_id: conversationId,
      role,
      content,
      attachments: JSON.stringify(attachments),
      tool_calls: toolCallsJson,
      created_at: now,
      updated_at: now,
    }
  }

  getLastUserMessage(conversationId: number): Array<{ role: Message['role']; content: string }> {
    const row = this.db.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(conversationId) as Pick<Message, 'role' | 'content'> | undefined
    return row ? [{ role: row.role, content: row.content }] : []
  }

  getSdkSessionId(conversationId: number): string | null {
    const row = this.db.prepare('SELECT sdk_session_id FROM conversations WHERE id = ?').get(conversationId) as { sdk_session_id: string | null } | undefined
    return row?.sdk_session_id ?? null
  }

  saveSdkSessionId(conversationId: number, sessionId: string): void {
    this.db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?').run(sessionId, conversationId)
  }

  clearSdkSessionId(conversationId: number): void {
    this.db.prepare('UPDATE conversations SET sdk_session_id = NULL, pi_session_file = NULL WHERE id = ?').run(conversationId)
  }

  updateTimestamp(conversationId: number): void {
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      conversationId
    )
  }

  getFolderOverrides(folderId: number): Record<string, string> {
    const row = this.db
      .prepare('SELECT ai_overrides FROM folders WHERE id = ?')
      .get(folderId) as { ai_overrides: string | null } | undefined
    return row?.ai_overrides ? safeJsonParse<Record<string, string>>(row.ai_overrides, {}) : {}
  }

  readRetrySettings(): { enabled: boolean; maxAttempts: number; initialDelayMs: number } {
    const rows = this.db
      .prepare("SELECT key, value FROM settings WHERE key IN ('retry_enabled', 'retry_maxAttempts', 'retry_initialDelayMs')")
      .all() as { key: string; value: string }[]
    const map: Record<string, string> = {}
    for (const row of rows) map[row.key] = row.value
    return {
      enabled: (map['retry_enabled'] ?? 'true') === 'true',
      maxAttempts: Math.max(1, Math.min(10, Number(map['retry_maxAttempts']) || 3)),
      initialDelayMs: Math.max(1000, Math.min(30000, Number(map['retry_initialDelayMs']) || 2000)),
    }
  }
}

/** Copy attachments into the conversation session folder */
export async function copyAttachmentsToSession(
  cwd: string,
  attachments: Attachment[]
): Promise<{ copied: Attachment[]; contentSuffix: string }> {
  if (!attachments.length) return { copied: attachments, contentSuffix: '' }

  const attachDir = join(cwd, 'attachments')
  await fsp.mkdir(attachDir, { recursive: true })

  const copied: Attachment[] = []
  const lines: string[] = []
  for (const att of attachments) {
    const destPath = await uniqueDestPath(attachDir, att.name)
    await fsp.copyFile(att.path, destPath)
    const finalName = basename(destPath)
    copied.push({ ...att, name: finalName, path: destPath })
    lines.push(`[${finalName}](${destPath})`)
  }

  const contentSuffix = '\n\n' + lines.join('\n')
  return { copied, contentSuffix }
}

async function uniqueDestPath(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  try { await fsp.access(candidate) } catch { return candidate }
  const ext = extname(name)
  const base = basename(name, ext)
  let i = 1
  while (i < 1000) {
    candidate = join(dir, `${base}_${i}${ext}`)
    try { await fsp.access(candidate) } catch { return candidate }
    i++
  }
  return candidate
}
