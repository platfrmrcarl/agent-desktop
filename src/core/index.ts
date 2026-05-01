// Core Engine — public API
//
// This barrel exposes only what is consumed by parts of the codebase
// outside `src/core/` (main, renderer, preload, headless, extensions).
// Symbols only used internally within `core/` should be imported
// directly from their source file, not re-exported here. This enforces
// the rule "core = single source for multi-consumed code" — the barrel
// reflects the *public* contract of the core module.
export { AgentEngine } from './engine'

// Ports
export type { Broadcaster } from './ports/broadcaster'
export { noopPlatformIO } from './ports/platformIO'
export { noopSystemUI } from './ports/systemUI'
export type { PlatformScheduler } from './ports/platformScheduler'
export { noopPlatformScheduler } from './ports/platformScheduler'
export type { HookRunner } from './ports/hookRunner'
export { noopHookRunner } from './ports/hookRunner'

// Services
export { SchedulerService, computeNextRun, getExpectedThemeFilename } from './services/scheduler'
export { executeTask } from './services/taskExecutor'
export type { TaskRunContext } from './services/taskExecutor'

// Types (re-exported for convenience)
export * from './types'
