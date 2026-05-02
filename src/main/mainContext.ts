/**
 * MainContext — central registry of Electron-side singletons that services
 * need to reach. Replaces the "import from '../index'" hub-star pattern that
 * created circular dependencies between `src/main/index.ts` and the services
 * it transitively loads.
 *
 * Usage:
 *   - `src/main/index.ts` calls `setMainContext({ ... })` once, after the
 *     main BrowserWindow is created and the engine/db are initialized.
 *   - Services call `getMainContext()` (or the `getMainWindow()` shortcut)
 *     instead of importing from `'../index'`.
 *
 * `mainWindow` is exposed as an accessor (`() => BrowserWindow | null`) so a
 * single context object can survive window recreation — when the user closes
 * the window and reopens it via the tray, the underlying `mainWindow` ref in
 * `index.ts` is reassigned and the closure picks up the new value transparently.
 */

import type { BrowserWindow, IpcMain } from 'electron'
import type { SqlJsAdapter } from '../core/db/sqljs-adapter'

export interface MainContext {
  /** Accessor for the current main window — may be null if it was closed. */
  mainWindow: () => BrowserWindow | null
  /** Electron IPC main bus — singleton, lifetime-equal-to-app. */
  ipcMain: IpcMain
  /** Initialized sql.js adapter — valid only after `engine.init()` has resolved. */
  db: SqlJsAdapter
}

let _ctx: MainContext | null = null

/**
 * Install the main context. Must be called exactly once, from `main/index.ts`,
 * before any service that calls `getMainContext()` runs.
 */
export function setMainContext(ctx: MainContext): void {
  _ctx = ctx
}

/**
 * Retrieve the main context. Throws if `setMainContext` has not been called —
 * surfaces ordering bugs at the first access rather than letting them propagate
 * as silent `undefined` reads.
 */
export function getMainContext(): MainContext {
  if (!_ctx) {
    throw new Error(
      'MainContext not initialized — setMainContext must be called from main/index.ts before any service uses getMainContext()',
    )
  }
  return _ctx
}

/**
 * Convenience accessor for the most common consumer pattern. Equivalent to
 * `getMainContext().mainWindow()`.
 */
export function getMainWindow(): BrowserWindow | null {
  return getMainContext().mainWindow()
}
