import type { HandleRegistrar } from '../dispatch'
import type { ErrorBuffer } from '../services/errorBuffer'
import type {
  BugReportMetadata,
  BugReportPayload,
  SendResult,
} from '../../shared/bugReport'

export interface BugReportHandlerOptions {
  mainBuffer: ErrorBuffer
  getMetadata: () => Promise<BugReportMetadata>
  getWebhookUrl: () => string
  sendBugReport: (payload: BugReportPayload, url: string) => Promise<SendResult>
  scrub: (text: string) => string
}

export function registerBugReportHandlers(
  registrar: HandleRegistrar,
  opts: BugReportHandlerOptions,
): void {
  registrar.handle('bug:getMainErrors', async () => {
    try {
      return opts.mainBuffer.getAll()
    } catch (err) {
      console.warn('[bug-report-internal] getMainErrors failed:', err)
      return []
    }
  })

  registrar.handle('bug:scrub', async (_event, text: unknown) => {
    if (typeof text !== 'string') return ''
    try {
      return opts.scrub(text)
    } catch (err) {
      console.warn('[bug-report-internal] scrub failed:', err)
      return text
    }
  })

  registrar.handle('bug:send', async (_event, payload: unknown) => {
    try {
      const { description, logs } = (payload ?? {}) as { description?: unknown; logs?: unknown }
      const metadata = await opts.getMetadata()
      const result = await opts.sendBugReport(
        {
          description: typeof description === 'string' ? description : '',
          logs: typeof logs === 'string' ? logs : '',
          metadata,
        },
        opts.getWebhookUrl(),
      )
      // Clear the main buffer on success so the next report doesn't duplicate.
      // Renderer clears its own buffer separately after it receives { ok: true }.
      if (result.ok) {
        try {
          opts.mainBuffer.clear()
        } catch (err) {
          console.warn('[bug-report-internal] clear after send failed:', err)
        }
      }
      return result
    } catch (err) {
      console.warn('[bug-report-internal] send failed:', err)
      return { ok: false, error: 'unknown' as const }
    }
  })
}
