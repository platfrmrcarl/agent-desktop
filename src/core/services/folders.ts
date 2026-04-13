import type Database from 'better-sqlite3'
import { validateString, validatePositiveInt } from '../utils/validate'
import type { Folder } from '../types'

export class FolderService {
  constructor(private db: Database.Database) {}

  list(): Folder[] {
    return this.db
      .prepare('SELECT * FROM folders ORDER BY position ASC, created_at ASC')
      .all() as Folder[]
  }

  create(name: string, parentId?: number): Folder {
    validateString(name, 'name', 500)
    if (parentId !== undefined) validatePositiveInt(parentId, 'parentId')
    const maxPos = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) as max FROM folders')
      .get() as { max: number }
    const result = this.db
      .prepare(
        `INSERT INTO folders (name, parent_id, position, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(name, parentId ?? null, maxPos.max + 1)
    return this.db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid) as Folder
  }

  update(id: number, data: Record<string, unknown>): void {
    validatePositiveInt(id, 'folderId')
    if (data.name !== undefined) validateString(data.name as string, 'name', 500)
    if (data.ai_overrides !== undefined && data.ai_overrides !== null) validateString(data.ai_overrides as string, 'ai_overrides', 10_000)
    if (data.default_cwd !== undefined && data.default_cwd !== null) validateString(data.default_cwd as string, 'default_cwd', 1000)
    if (data.color !== undefined && data.color !== null) {
      const c = data.color as string
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('color must be a valid hex color (#rrggbb)')
    }
    if ('parent_id' in data && data.parent_id !== null && data.parent_id !== undefined) {
      validatePositiveInt(data.parent_id as number, 'parent_id')
      if (data.parent_id === id) throw new Error('Folder cannot be its own parent')
      // Walk ancestors to detect cycle
      let current = data.parent_id as number
      const visited = new Set<number>([id])
      while (current) {
        if (visited.has(current)) throw new Error('Circular folder reference detected')
        visited.add(current)
        const parent = this.db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(current) as { parent_id: number | null } | undefined
        current = parent?.parent_id ?? 0
      }
    }
    const allowed = ['name', 'parent_id', 'ai_overrides', 'default_cwd', 'color']
    const fields: string[] = []
    const values: unknown[] = []
    for (const key of allowed) {
      if (key in data) {
        fields.push(`${key} = ?`)
        values.push(data[key])
      }
    }
    if (fields.length === 0) return
    fields.push("updated_at = datetime('now')")
    values.push(id)
    this.db.prepare(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`).run(
      ...values
    )
  }

  delete(id: number, mode?: string): void {
    validatePositiveInt(id, 'folderId')

    const folder = this.db.prepare('SELECT is_default FROM folders WHERE id = ?').get(id) as { is_default: number } | undefined
    if (folder?.is_default === 1) throw new Error('Cannot delete the default folder')

    const defaultFolder = this.db.prepare('SELECT id FROM folders WHERE is_default = 1').get() as { id: number }

    if (mode === 'delete') {
      const allIds: number[] = [id]
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()!
        const children = this.db
          .prepare('SELECT id FROM folders WHERE parent_id = ?')
          .all(current) as { id: number }[]
        for (const child of children) {
          allIds.push(child.id)
          queue.push(child.id)
        }
      }

      const placeholders = allIds.map(() => '?').join(',')
      const deleteAll = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM conversations WHERE folder_id IN (${placeholders})`).run(
          ...allIds
        )
        this.db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...allIds)
      })
      deleteAll()
    } else {
      this.db.prepare('UPDATE conversations SET folder_id = ? WHERE folder_id = ?').run(defaultFolder.id, id)
      this.db.prepare('UPDATE folders SET parent_id = NULL WHERE parent_id = ?').run(id)
      this.db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    }
  }

  reorder(ids: number[]): void {
    if (!Array.isArray(ids)) throw new Error('ids must be an array')
    for (const id of ids) validatePositiveInt(id, 'folderId')
    const stmt = this.db.prepare('UPDATE folders SET position = ? WHERE id = ?')
    const reorder = this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i])
      }
    })
    reorder()
  }

  getDefault(): Folder {
    return this.db.prepare('SELECT * FROM folders WHERE is_default = 1').get() as Folder
  }
}
