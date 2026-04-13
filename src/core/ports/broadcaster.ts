/**
 * Port: push events to connected clients (renderer, WebSocket, stdout...).
 *
 * The core engine emits typed events via TypedEventEmitter.
 * A Broadcaster subscribes to those events and forwards them
 * to whatever transport the host provides (Electron webContents,
 * WebSocket, console, etc.).
 */
export interface Broadcaster {
  broadcast(channel: string, data: unknown): void
}
