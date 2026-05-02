import { ErrorBuffer, INTERNAL_LOG_PREFIX } from '../../core/services/errorBuffer'

// consumed by rendererErrorCapture.test.ts (excluded). (suppressed below)
// fallow-ignore-next-line unused-export
export { INTERNAL_LOG_PREFIX }

export const rendererErrorBuffer = new ErrorBuffer()

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

export function patchRendererConsoleError(buffer: ErrorBuffer): () => void {
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
        source: 'renderer',
        level: 'error',
        message: formatArgs(args),
      })
    } catch {
      // never throw from a patched console
    }
  }) as typeof console.error
  return () => {
    console.error = original
  }
}

export function installGlobalErrorHandlers(buffer: ErrorBuffer): () => void {
  const onError = (ev: ErrorEvent): void => {
    const isCrossOrigin = !ev.filename && ev.lineno === 0 && ev.colno === 0
    const suffix = isCrossOrigin ? ' (cross-origin, details withheld by browser)' : ''
    buffer.push({
      timestamp: new Date().toISOString(),
      source: 'renderer',
      level: 'error',
      message: `window.onerror: ${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}${suffix}`,
    })
  }
  const onRejection = (ev: PromiseRejectionEvent): void => {
    const reason = ev.reason
    const text =
      reason == null
        ? '(no reason)'
        : reason instanceof Error
          ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
          : String(reason)
    buffer.push({
      timestamp: new Date().toISOString(),
      source: 'renderer',
      level: 'error',
      message: `unhandledrejection: ${text}`,
    })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
