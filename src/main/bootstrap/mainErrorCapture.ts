import { inspect } from 'util'
import type { ErrorBuffer } from '../../core/services/errorBuffer'
import { INTERNAL_LOG_PREFIX } from '../../core/services/errorBuffer'

export { INTERNAL_LOG_PREFIX }

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: 120 })))
    .join(' ')
}

export function patchConsoleError(buffer: ErrorBuffer): () => void {
  const original = console.error
  console.error = ((...args: unknown[]) => {
    const firstArg = args[0]
    const isInternal =
      typeof firstArg === 'string' && firstArg.startsWith(INTERNAL_LOG_PREFIX)
    try {
      original.apply(console, args)
      if (isInternal) return
      buffer.push({
        timestamp: new Date().toISOString(),
        source: 'main',
        level: 'error',
        message: formatArgs(args),
      })
    } catch {
      // swallow: we cannot log here without recursing
    }
  }) as typeof console.error
  return () => {
    console.error = original
  }
}
