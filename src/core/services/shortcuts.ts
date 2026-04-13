import type Database from 'better-sqlite3'
import type { KeyboardShortcut } from '../types'
import { validateString, validatePositiveInt } from '../utils/validate'

export class ShortcutsService {
  constructor(private db: Database.Database) {}

  list(): KeyboardShortcut[] {
    return this.db
      .prepare('SELECT * FROM keyboard_shortcuts')
      .all() as KeyboardShortcut[]
  }

  update(id: number, keybinding: string): void {
    validatePositiveInt(id, 'shortcutId')
    validateString(keybinding, 'keybinding', 100)
    const existing = this.db
      .prepare('SELECT * FROM keyboard_shortcuts WHERE id = ?')
      .get(id) as KeyboardShortcut | undefined
    if (!existing) throw new Error(`Shortcut ${id} not found`)

    this.db.prepare(
      "UPDATE keyboard_shortcuts SET keybinding = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(keybinding, id)
  }
}
