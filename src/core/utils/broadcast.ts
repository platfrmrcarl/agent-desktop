type BroadcastFn = (channel: string, ...args: unknown[]) => void

const handlers = new Set<BroadcastFn>()

/** Add a broadcast handler. Returns an unsubscribe function. */
export function addBroadcastHandler(fn: BroadcastFn): () => void {
  handlers.add(fn)
  return () => { handlers.delete(fn) }
}

/** Backward-compat: clear all handlers, then add one. */
export function setBroadcastHandler(fn: BroadcastFn): void {
  handlers.clear()
  if (fn) handlers.add(fn)
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const fn of handlers) fn(channel, ...args)
}
