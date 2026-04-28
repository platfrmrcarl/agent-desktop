import type { PiUIResponse } from '../../shared/piUITypes'

/**
 * Registry of active PiUIContext instances, keyed by conversationId.
 *
 * Lives in core (not main) so the headless-bundleable streamingPI can
 * register/unregister contexts without pulling in the Electron-only
 * IPC handlers (those still live in src/main/services/piExtensions.ts).
 */
export interface PiUIRegistryEntry {
  handleResponse: (r: PiUIResponse) => void
  handleTuiInput?: (id: string, data: string) => void
}

const activeContexts = new Map<number, PiUIRegistryEntry>()

export function registerPiUIContext(conversationId: number, ctx: PiUIRegistryEntry): void {
  activeContexts.set(conversationId, ctx)
}

export function unregisterPiUIContext(conversationId: number): void {
  activeContexts.delete(conversationId)
}

export function getActivePiUIContexts(): IterableIterator<PiUIRegistryEntry> {
  return activeContexts.values()
}
