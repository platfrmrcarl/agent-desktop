import { inspect } from 'util'
import type { ErrorBuffer } from '../../core/services/errorBuffer'

export const INTERNAL_LOG_PREFIX = '[bug-report-internal]'

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: 120 })))
    .join(' ')
}

export function patchConsoleError(buffer: ErrorBuffer): () => void {
  const original = console.error
  console.error = ((...args: unknown[]) => {
    try {
      original.apply(console, args)
      const message = formatArgs(args)
      if (message.startsWith(INTERNAL_LOG_PREFIX)) return
      buffer.push({
        timestamp: new Date().toISOString(),
        source: 'main',
        level: 'error',
        message,
      })
    } catch {
      // swallow: we cannot log here without recursing
    }
  }) as typeof console.error
  return () => {
    console.error = original
  }
}
