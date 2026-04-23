import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { ExtensionRuntimeContext } from '../../../core/services/piExtensionBridge'

/**
 * Uniform signature for every module inside this extension.
 * Each module exports a single function that wires up its event handlers.
 */
export type ModuleInit = (pi: ExtensionAPI, ctx: ExtensionRuntimeContext) => void | Promise<void>

export type { ExtensionRuntimeContext } from '../../../core/services/piExtensionBridge'
export type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
