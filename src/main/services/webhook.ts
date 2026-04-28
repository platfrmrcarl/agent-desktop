import { net } from 'electron'
import { validateWebhookUrl } from '../../core/utils/webhookValidation'

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
  const validation = validateWebhookUrl(url)
  if (!validation.ok) {
    console.warn(`[webhook] rejected URL: ${validation.reason}`)
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
      console.warn(`[webhook] POST ${url} returned ${res.status}`)
    }
  } catch (err) {
    console.error('[webhook] Error:', err instanceof Error ? err.message : String(err))
  }
}
