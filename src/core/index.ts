// Core Engine — public API
export { AgentEngine } from './engine'
export type { EngineEvents, EngineOptions } from './engine'
export { TypedEventEmitter } from './events'
export type { EventMap } from './events'

// Ports
export type { Broadcaster } from './ports/broadcaster'
export type { PlatformIO } from './ports/platformIO'
export { noopPlatformIO } from './ports/platformIO'
export type { SystemUI } from './ports/systemUI'
export { noopSystemUI } from './ports/systemUI'
export type { PlatformScheduler } from './ports/platformScheduler'
export { noopPlatformScheduler } from './ports/platformScheduler'

// Services
export { SchedulerService, computeNextRun, getExpectedThemeFilename } from './services/scheduler'
export { executeTask } from './services/taskExecutor'
export type { TaskRunContext, StreamResult } from './services/taskExecutor'

// Types (re-exported for convenience)
export * from './types'
