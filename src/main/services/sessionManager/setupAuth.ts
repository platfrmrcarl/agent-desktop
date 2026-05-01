/**
 * Auth env setup for a new SDK session.
 *
 * Two responsibilities, both env-mutating:
 *   1. macOS OAuth token freshness (only when no explicit apiKey override).
 *   2. Inject ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL into process.env for the
 *      duration of the SDK subprocess; returns a `restoreEnv()` thunk the
 *      caller MUST invoke on session teardown to put the previous values
 *      back. Returns `null` when nothing was injected (no apiKey override).
 *
 * Extracted from sessionManager.createSession to keep that function close to
 * pure orchestration.
 */
import { ensureFreshMacOSToken } from '../../utils/env'
import { injectApiKeyEnv } from '../streaming'
import type { AISettings } from '../streaming'

export async function setupAuth(aiSettings: AISettings): Promise<(() => void) | null> {
  if (!aiSettings?.apiKey) {
    await ensureFreshMacOSToken()
  }
  return injectApiKeyEnv(aiSettings?.apiKey, aiSettings?.baseUrl)
}
