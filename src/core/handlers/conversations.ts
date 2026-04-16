import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { ConversationService } from '../services/conversations'

export function registerConversationsHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new ConversationService(db as any)

  registrar.handle('conversations:list', async () => {
    try {
      return service.list()
    } catch (err) {
      throw new Error(`Failed to list conversations: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:get', async (_event, id: unknown) => {
    try {
      return service.get(id as number)
    } catch (err) {
      throw new Error(`Failed to get conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:markOpened', async (_event, id: unknown) => {
    try {
      service.markOpened(id as number)
    } catch (err) {
      throw new Error(`Failed to mark conversation opened: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:create', async (_event, title?: unknown, folderId?: unknown) => {
    try {
      return service.create(title as string | undefined, folderId as number | undefined)
    } catch (err) {
      throw new Error(`Failed to create conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:update', async (_event, id: unknown, data: unknown) => {
    try {
      // Omit Electron-specific side effect: invalidateCwdCache
      service.update(id as number, data as Record<string, unknown>)
    } catch (err) {
      throw new Error(`Failed to update conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:delete', async (_event, id: unknown) => {
    try {
      // Omit Electron-specific side effects: reassignOrphanedTasks, invalidateSession
      service.delete(id as number)
    } catch (err) {
      throw new Error(`Failed to delete conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:deleteMany', async (_event, ids: unknown) => {
    try {
      // Omit Electron-specific side effects: reassignOrphanedTasks, invalidateSession
      service.deleteMany(ids as number[])
    } catch (err) {
      throw new Error(`Failed to delete conversations: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:moveMany', async (_event, ids: unknown, folderId: unknown) => {
    try {
      service.moveMany(ids as number[], folderId as number | null)
    } catch (err) {
      throw new Error(`Failed to move conversations: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:colorMany', async (_event, ids: unknown, color: unknown) => {
    try {
      service.colorMany(ids as number[], color as string | null)
    } catch (err) {
      throw new Error(`Failed to color conversations: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:export', async (_event, id: unknown, format: unknown) => {
    try {
      return service.export(id as number, format as 'markdown' | 'json')
    } catch (err) {
      throw new Error(`Failed to export conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:import', async (_event, data: unknown) => {
    try {
      return service.import(data as string)
    } catch (err) {
      throw new Error(`Failed to import conversation: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:search', async (_event, query: unknown) => {
    try {
      return service.search(query as string)
    } catch (err) {
      throw new Error(`Failed to search conversations: ${(err as Error).message}`)
    }
  })

  registrar.handle('conversations:fork', async (_event, sourceConversationId: unknown, messageId: unknown) => {
    try {
      return service.fork(sourceConversationId as number, messageId as number)
    } catch (err) {
      throw new Error(`Failed to fork conversation: ${(err as Error).message}`)
    }
  })
}
