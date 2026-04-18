import type { HandleRegistrar } from '../dispatch'
import type { ErrorBuffer } from '../services/errorBuffer'
import { sendBugReport, type BugReportMetadata } from '../../main/services/bugReport'
import { scrub } from '../../main/services/logScrubber'

export interface BugReportHandlerOptions {
  mainBuffer: ErrorBuffer
  getMetadata: () => Promise<BugReportMetadata>
  getWebhookUrl: () => string
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
      return scrub(text)
    } catch (err) {
      console.warn('[bug-report-internal] scrub failed:', err)
      return text
    }
  })

  registrar.handle('bug:send', async (_event, payload: unknown) => {
    try {
      const { description, logs } = (payload ?? {}) as { description?: unknown; logs?: unknown }
      const metadata = await opts.getMetadata()
      return await sendBugReport(
        {
          description: typeof description === 'string' ? description : '',
          logs: typeof logs === 'string' ? logs : '',
          metadata,
        },
        opts.getWebhookUrl(),
      )
    } catch (err) {
      console.warn('[bug-report-internal] send failed:', err)
      return { ok: false, error: 'unknown' as const }
    }
  })
}
