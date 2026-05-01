import { EventEmitter } from 'events'

/**
 * Type-safe EventEmitter.
 *
 * EventMap is a record of event names to their argument tuples:
 *   { 'stream:chunk': [conversationId: number, chunk: StreamChunk] }
 *
 * This ensures emit() and on() are type-checked at compile time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap = Record<string, any[]>

export class TypedEventEmitter<T extends EventMap> {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(50)
  }

  emit<K extends keyof T & string>(event: K, ...args: T[K]): boolean {
    return this.emitter.emit(event, ...args)
  }

  on<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  once<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof T & string>(event: K, listener: (...args: T[K]) => void): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  removeAllListeners<K extends keyof T & string>(event?: K): this {
    this.emitter.removeAllListeners(event)
    return this
  }
}
