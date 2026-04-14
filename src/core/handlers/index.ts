import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import type { Broadcaster } from '../ports/broadcaster'
import type { HookRunner } from '../ports/hookRunner'
import { registerSettingsHandlers } from './settings'
import { registerFoldersHandlers } from './folders'
import { registerConversationsHandlers } from './conversations'
import { registerToolsHandlers } from './tools'
import { registerShortcutsHandlers } from './shortcuts'
import { registerMcpHandlers } from './mcp'
import { registerAuthHandlers } from './auth'
import { registerAttachmentsHandlers } from './attachments'
import { registerMessagesHandlers } from './messages'

export interface CoreHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
}

export function registerCoreHandlers(
  registrar: HandleRegistrar,
  db: SqlJsAdapter,
  options: CoreHandlerOptions,
): void {
  registerSettingsHandlers(registrar, db)
  registerFoldersHandlers(registrar, db)
  registerConversationsHandlers(registrar, db)
  registerToolsHandlers(registrar, db)
  registerShortcutsHandlers(registrar, db)
  registerMcpHandlers(registrar, db)
  registerAuthHandlers(registrar, db)
  registerAttachmentsHandlers(registrar, db)
  registerMessagesHandlers(registrar, db, {
    broadcaster: options.broadcaster,
    hookRunner: options.hookRunner,
    sessionsBase: options.sessionsBase,
  })
}
