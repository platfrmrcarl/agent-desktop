// Temporary re-export during migration — existing imports in main process continue to work
export {
  startServer,
  stopServer,
  getServerStatus,
  registerHandlers,
  getWsBroadcaster,
} from '../../core/services/webServer'
export type { ServerStartOptions } from '../../core/services/webServer'
