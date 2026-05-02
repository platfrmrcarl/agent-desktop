import { net } from 'electron'
import { validateWebhookUrl, validateWebhookUrlAsync } from '../../core/utils/webhookValidation'
import { createLogger } from '../../core/utils/logger'

const log = createLogger('webhook')

export type { WebhookValidationResult } from '../../core/utils/webhookValidation'
export { validateWebhookUrl } from '../../core/utils/webhookValidation'

export interface CompletionPayload {
  event: 'completion' | 'completion_with_error'
  conversationId: number
  conversationTitle: string
  messageId: number
  content: string
  model: string
  stopReason: string | undefined
  createdAt: string
  error?: string
}

export async function fireCompletionWebhook(
  url: string,
  payload: CompletionPayload
): Promise<void> {
  const validation = await validateWebhookUrlAsync(url)
  if (!validation.ok) {
    log.warn('rejected URL', { reason: validation.reason })
    return
  }

  try {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
    if (!res.ok) {
      log.warn('webhook returned non-ok status', { url, status: res.status })
    }
  } catch (err) {
    log.error('webhook error', err)
  }
}
