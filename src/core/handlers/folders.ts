import type { HandleRegistrar } from '../dispatch'
import type { SqlJsAdapter } from '../db/sqljs-adapter'
import { FolderService } from '../services/folders'

export function registerFoldersHandlers(registrar: HandleRegistrar, db: SqlJsAdapter): void {
  const service = new FolderService(db as any)

  registrar.handle('folders:list', async () => {
    try {
      return service.list()
    } catch (err) {
      throw new Error(`Failed to list folders: ${(err as Error).message}`)
    }
  })

  registrar.handle('folders:create', async (_event, name: unknown, parentId?: unknown) => {
    try {
      return service.create(name as string, parentId as number | undefined)
    } catch (err) {
      throw new Error(`Failed to create folder: ${(err as Error).message}`)
    }
  })

  registrar.handle('folders:update', async (_event, id: unknown, data: unknown) => {
    try {
      service.update(id as number, data as Record<string, unknown>)
    } catch (err) {
      throw new Error(`Failed to update folder: ${(err as Error).message}`)
    }
  })

  registrar.handle('folders:delete', async (_event, id: unknown, mode?: unknown) => {
    try {
      service.delete(id as number, mode as string | undefined)
    } catch (err) {
      throw new Error(`Failed to delete folder: ${(err as Error).message}`)
    }
  })

  registrar.handle('folders:reorder', async (_event, ids: unknown) => {
    try {
      service.reorder(ids as number[])
    } catch (err) {
      throw new Error(`Failed to reorder folders: ${(err as Error).message}`)
    }
  })

  registrar.handle('folders:getDefault', async () => {
    try {
      return service.getDefault()
    } catch (err) {
      throw new Error(`Failed to get default folder: ${(err as Error).message}`)
    }
  })
}
