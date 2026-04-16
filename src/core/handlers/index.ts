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
import { registerModelsHandlers } from './models'
import { registerAttachmentsHandlers } from './attachments'
import { registerMessagesHandlers } from './messages'
import { registerFilesHandlers } from './files'
import { registerThemesHandlers } from './themes'
import { registerCommandsHandlers } from './commands'
import { registerKnowledgeHandlers } from './knowledge'
import { registerSchedulerHandlers } from './scheduler'
import { registerTtsHandlers } from './tts'
import { registerWhisperHandlers } from './whisper'
import { registerSystemHandlers } from './system'

export interface CoreHandlerOptions {
  broadcaster: Broadcaster
  hookRunner: HookRunner
  sessionsBase: string
  themesDir: string
  knowledgesDir: string
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
  registerModelsHandlers(registrar)
  registerAttachmentsHandlers(registrar, db)
  registerMessagesHandlers(registrar, db, {
    broadcaster: options.broadcaster,
    hookRunner: options.hookRunner,
    sessionsBase: options.sessionsBase,
  })
  registerFilesHandlers(registrar, db, { sessionsBase: options.sessionsBase })
  registerThemesHandlers(registrar, options.themesDir)
  registerCommandsHandlers(registrar, db)
  registerKnowledgeHandlers(registrar, options.knowledgesDir)
  registerSchedulerHandlers(registrar, db)
  registerTtsHandlers(registrar, db)
  registerWhisperHandlers(registrar, db)
  registerSystemHandlers(registrar, db)
}
