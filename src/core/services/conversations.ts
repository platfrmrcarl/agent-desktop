import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'
import { DEFAULT_MODEL } from '../types/constants'
import type { Conversation, ConversationWithMessages } from '../types'

const SEARCH_RESULTS_LIMIT = 50

export class ConversationService {
  constructor(private db: Database.Database) {}

  list(): Conversation[] {
    return this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
         FROM conversations c ORDER BY updated_at DESC`
      )
      .all() as Conversation[]
  }

  /** Returns the ID of the most recent conversation containing a user message, excluding given IDs. */
  findLastUserConversationId(excludeIds: number[] = []): number | null {
    const filtered = excludeIds.filter((n) => Number.isFinite(n) && n > 0)
    const notInClause = filtered.length > 0
      ? `AND c.id NOT IN (${filtered.map(() => '?').join(',')})`
      : ''
    const row = this.db
      .prepare(
        `SELECT c.id
         FROM conversations c
         INNER JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
         WHERE 1=1 ${notInClause}
         GROUP BY c.id
         ORDER BY MAX(m.created_at) DESC
         LIMIT 1`
      )
      .get(...filtered) as { id: number } | undefined
    return row ? row.id : null
  }

  /** Returns the ID of the most recently opened conversation (last_opened_at), excluding given IDs. */
  findLastOpenedConversationId(excludeIds: number[] = []): number | null {
    const filtered = excludeIds.filter((n) => Number.isFinite(n) && n > 0)
    const notInClause = filtered.length > 0
      ? `AND c.id NOT IN (${filtered.map(() => '?').join(',')})`
      : ''
    const row = this.db
      .prepare(
        `SELECT c.id
         FROM conversations c
         WHERE c.last_opened_at IS NOT NULL ${notInClause}
         ORDER BY c.last_opened_at DESC
         LIMIT 1`
      )
      .get(...filtered) as { id: number } | undefined
    return row ? row.id : null
  }

  /** Bumps last_opened_at to 'now' for the given conversation. Silently ignores non-existent ids. */
  markOpened(id: number): void {
    validatePositiveInt(id, 'conversationId')
    this.db
      .prepare("UPDATE conversations SET last_opened_at = datetime('now') WHERE id = ?")
      .run(id)
  }

  get(id: number): ConversationWithMessages | null {
    validatePositiveInt(id, 'conversationId')
    const conversation = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Conversation | undefined
    if (!conversation) return null
    const messages = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(id)
    return { ...conversation, messages } as ConversationWithMessages
  }

  create(title?: string, folderId?: number): Conversation {
    if (title !== undefined) validateString(title, 'title', 500)
    if (folderId !== undefined) validatePositiveInt(folderId, 'folderId')
    const modelRow = this.db
      .prepare("SELECT value FROM settings WHERE key = 'ai_model'")
      .get() as { value: string } | undefined
    const globalModel = modelRow?.value || DEFAULT_MODEL

    const resolvedFolderId = folderId ??
      (this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number }).id

    const folderRow = this.db.prepare('SELECT default_cwd, ai_overrides FROM folders WHERE id = ?')
      .get(resolvedFolderId) as { default_cwd: string | null; ai_overrides: string | null } | undefined
    const defaultCwd = folderRow?.default_cwd || null
    const folderOverrides = folderRow?.ai_overrides ? JSON.parse(folderRow.ai_overrides) as Record<string, string> : {}
    const model = folderOverrides['ai_model'] || globalModel

    const result = this.db
      .prepare(
        `INSERT INTO conversations (title, folder_id, model, cwd, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      )
      .run(title || 'New Conversation', resolvedFolderId, model, defaultCwd)
    return this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(result.lastInsertRowid) as Conversation
  }

  /** Update conversation fields. Returns true if cwd was changed (for cache invalidation). */
  update(id: number, data: Record<string, unknown>): { cwdChanged: boolean } {
    validatePositiveInt(id, 'conversationId')
    if (data.title !== undefined) validateString(data.title as string, 'title', 500)
    if (data.model !== undefined) validateString(data.model as string, 'model', 200)
    if (data.system_prompt !== undefined && data.system_prompt !== null) validateString(data.system_prompt as string, 'system_prompt', 100_000)
    if (data.cwd !== undefined && data.cwd !== null) validateString(data.cwd as string, 'cwd', 1000)
    if (data.ai_overrides !== undefined && data.ai_overrides !== null) validateString(data.ai_overrides as string, 'ai_overrides', 10_000)
    if (data.cleared_at !== undefined && data.cleared_at !== null) validateString(data.cleared_at as string, 'cleared_at', 50)
    if (data.folder_id !== undefined && data.folder_id !== null) validatePositiveInt(data.folder_id as number, 'folderId')
    if (data.color !== undefined && data.color !== null) {
      const c = data.color as string
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('color must be a valid hex color (#rrggbb)')
    }
    const allowed = ['title', 'folder_id', 'position', 'model', 'system_prompt', 'kb_enabled', 'cwd', 'ai_overrides', 'cleared_at', 'compact_summary', 'sdk_session_id', 'pi_session_file', 'color']
    if (data.cleared_at !== undefined && data.cleared_at !== null) {
      data.sdk_session_id = null
    }
    const fields: string[] = []
    const values: unknown[] = []
    for (const key of allowed) {
      if (key in data) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    if (fields.length === 0) return { cwdChanged: false }
    fields.push("updated_at = datetime('now')")
    values.push(id)
    this.db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values
    )
    return { cwdChanged: 'cwd' in data }
  }

  /** Delete a single conversation. Returns the id for side-effect handling. */
  delete(id: number): number {
    validatePositiveInt(id, 'conversationId')
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
    return id
  }

  deleteMany(ids: number[]): number[] {
    if (!Array.isArray(ids) || ids.length === 0) return []
    for (const id of ids) validatePositiveInt(id, 'conversationId')
    const stmt = this.db.prepare('DELETE FROM conversations WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) stmt.run(id) })()
    return ids
  }

  moveMany(ids: number[], folderId: number | null): void {
    if (!Array.isArray(ids) || ids.length === 0) return
    for (const id of ids) validatePositiveInt(id, 'conversationId')
    if (folderId !== null) validatePositiveInt(folderId, 'folderId')
    const stmt = this.db.prepare("UPDATE conversations SET folder_id = ?, updated_at = datetime('now') WHERE id = ?")
    this.db.transaction(() => { for (const id of ids) stmt.run(folderId, id) })()
  }

  colorMany(ids: number[], color: string | null): void {
    if (!Array.isArray(ids) || ids.length === 0) return
    for (const id of ids) validatePositiveInt(id, 'conversationId')
    if (color !== null) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('color must be a valid hex color (#rrggbb)')
    }
    const stmt = this.db.prepare("UPDATE conversations SET color = ?, updated_at = datetime('now') WHERE id = ?")
    this.db.transaction(() => { for (const id of ids) stmt.run(color, id) })()
  }

  export(id: number, format: 'markdown' | 'json'): string {
    validatePositiveInt(id, 'conversationId')
    validateString(format, 'format', 20)
    const conversation = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    if (!conversation) return ''
    const messages = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(id) as Array<Record<string, unknown>>

    if (format === 'markdown') {
      let md = `# ${conversation.title}\n\n`
      for (const msg of messages) {
        const role = msg.role === 'user' ? 'You' : 'Assistant'
        md += `## ${role}\n\n${msg.content}\n\n`
      }
      return md
    }

    return JSON.stringify({ conversation, messages }, null, 2)
  }

  import(data: string): Conversation {
    validateString(data, 'data', 10_000_000)

    let parsed: any
    try { parsed = JSON.parse(data) }
    catch { throw new Error('Invalid JSON format') }

    const { conversation, messages } = parsed

    const title = typeof conversation?.title === 'string' ? conversation.title.slice(0, 500) : 'Imported Conversation'
    const model = typeof conversation?.model === 'string' ? conversation.model.slice(0, 200) : DEFAULT_MODEL
    const systemPrompt = (typeof conversation?.system_prompt === 'string') ? conversation.system_prompt : null
    const kbEnabled = conversation?.kb_enabled === 1 ? 1 : 0

    const defaultFolderId = (this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number }).id

    const insertConv = this.db.prepare(
      `INSERT INTO conversations (title, folder_id, model, system_prompt, kb_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    const insertMsg = this.db.prepare(
      `INSERT INTO messages (conversation_id, role, content, attachments, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )

    const importConv = this.db.transaction(() => {
      const result = insertConv.run(title, defaultFolderId, model, systemPrompt, kbEnabled)
      const newId = result.lastInsertRowid

      if (Array.isArray(messages)) {
        for (const msg of messages) {
          if (msg.role !== 'user' && msg.role !== 'assistant') continue
          const content = typeof msg.content === 'string' ? msg.content : ''
          const attachments = typeof msg.attachments === 'string' ? msg.attachments : '[]'
          let createdAt: string
          try {
            createdAt = new Date(msg.created_at).toISOString()
          } catch {
            createdAt = new Date().toISOString()
          }
          insertMsg.run(newId, msg.role, content, attachments, createdAt)
        }
      }
      return newId
    })

    const newId = importConv()
    return this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(newId) as Conversation
  }

  search(query: string): Conversation[] {
    validateString(query, 'query', 500)
    const pattern = `%${query}%`
    return this.db
      .prepare(
        `SELECT DISTINCT c.*, (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? OR m.content LIKE ?
         ORDER BY c.updated_at DESC
         LIMIT ${SEARCH_RESULTS_LIMIT}`
      )
      .all(pattern, pattern) as Conversation[]
  }

  fork(sourceConversationId: number, messageId: number): Conversation {
    validatePositiveInt(sourceConversationId, 'sourceConversationId')
    validatePositiveInt(messageId, 'messageId')

    const source = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(sourceConversationId) as Record<string, unknown> | undefined
    if (!source) throw new Error('Conversation not found')

    const targetMessage = this.db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, sourceConversationId) as Record<string, unknown> | undefined
    if (!targetMessage) throw new Error('Message not found')

    const forkConv = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO conversations (title, folder_id, model, system_prompt, kb_enabled, cwd, ai_overrides, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        )
        .run(
          `Fork: ${source.title}`,
          source.folder_id,
          source.model,
          source.system_prompt,
          source.kb_enabled,
          source.cwd,
          source.ai_overrides
        )
      const newId = result.lastInsertRowid

      const clearedAt = source.cleared_at as string | null
      const targetCreatedAt = targetMessage.created_at as string

      if (clearedAt && targetCreatedAt > clearedAt) {
        this.db.prepare(
          `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
           SELECT ?, role, content, attachments, tool_calls, created_at, updated_at
           FROM messages
           WHERE conversation_id = ? AND created_at <= ? AND created_at > ?
           ORDER BY created_at ASC`
        ).run(newId, sourceConversationId, targetCreatedAt, clearedAt)
        if (source.compact_summary) {
          this.db.prepare('UPDATE conversations SET compact_summary = ? WHERE id = ?')
            .run(source.compact_summary, newId)
        }
      } else {
        this.db.prepare(
          `INSERT INTO messages (conversation_id, role, content, attachments, tool_calls, created_at, updated_at)
           SELECT ?, role, content, attachments, tool_calls, created_at, updated_at
           FROM messages
           WHERE conversation_id = ? AND created_at <= ?
           ORDER BY created_at ASC`
        ).run(newId, sourceConversationId, targetCreatedAt)
      }

      return newId
    })()

    return this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(forkConv) as Conversation
  }
}
