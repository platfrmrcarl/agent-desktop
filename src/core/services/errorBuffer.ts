export interface ErrorEntry {
  timestamp: string
  source: 'main' | 'renderer'
  level: 'error'
  message: string
}

export const ERROR_BUFFER_MAX_COUNT = 50
export const ERROR_BUFFER_MAX_BYTES = 10_000
export const ERROR_BUFFER_TTL_MS = 60 * 60 * 1000

type PushListener = () => void

export class ErrorBuffer {
  private entries: ErrorEntry[] = []
  private listeners: Set<PushListener> = new Set()

  push(entry: ErrorEntry): void {
    this.entries.push(entry)
    this.evict()
    this.listeners.forEach((cb) => {
      try {
        cb()
      } catch {
        // ignore listener failures
      }
    })
  }

  getAll(): ErrorEntry[] {
    this.evict()
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  onPush(listener: PushListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private evict(): void {
    const now = Date.now()
    this.entries = this.entries.filter((e) => {
      const t = Date.parse(e.timestamp)
      return Number.isFinite(t) && now - t <= ERROR_BUFFER_TTL_MS
    })
    while (this.entries.length > ERROR_BUFFER_MAX_COUNT) {
      this.entries.shift()
    }
    let total = this.entries.reduce((n, e) => n + e.message.length, 0)
    while (total > ERROR_BUFFER_MAX_BYTES && this.entries.length > 0) {
      total -= this.entries[0].message.length
      this.entries.shift()
    }
  }
}
