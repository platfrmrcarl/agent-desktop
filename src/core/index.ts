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
export { noopHookRunner } from './ports/hookRunner'

// Types (re-exported for convenience)
export * from './types'
