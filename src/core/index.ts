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

// Types (re-exported for convenience)
export * from './types'
