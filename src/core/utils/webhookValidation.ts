/**
 * Validates a webhook URL against an SSRF blocklist.
 *
 * Rules:
 *  - Must be http:// or https://.
 *  - Hostname must not be localhost (unless AGENT_DESKTOP_ALLOW_LOCAL_WEBHOOK=1).
 *  - IP address (parsed by WHATWG URL — handles decimal/hex/octal forms) must not fall
 *    in a private/loopback/link-local range.
 *
 * DNS rebinding mitigation (validateWebhookUrlAsync):
 *  - Resolves the hostname via DNS immediately before the fetch call.
 *  - Applies the same blocklist to the resolved IP address.
 *  - Residual TOCTOU: milliseconds between lookup and the kernel resolving inside
 *    net.fetch — real but narrow window. Not bulletproof; defense-in-depth only.
 *
 * NOTE:
 *  - IPv4-mapped IPv6 (::ffff:0:0/96): partially mitigated by the ::ffff: string check
 *    below but not exhaustive against all normalisation forms.
 */

import dns from 'dns'

export type WebhookValidationResult = { ok: true } | { ok: false; reason: string }

export type WebhookValidationAsyncResult =
  | { ok: true; resolvedIp: string; hostname: string; family: 4 | 6 }
  | { ok: false; reason: string }

// Normalise raw hostname extracted from WHATWG URL:
//  - lowercase
//  - strip trailing dot
//  - strip IPv6 brackets
function normaliseHostname(raw: string): string {
  return raw.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
}

// Returns true if the dotted-decimal IPv4 string falls in a blocked range.
// WHATWG URL always normalises IPv4 to dotted-decimal before exposing .hostname,
// so decimal/hex/octal input variants are handled automatically.
function isBlockedIPv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  const [a, b, c] = parts.map(Number)

  return (
    a === 127 ||               // 127.0.0.0/8 loopback
    a === 10 ||                // 10.0.0.0/8 private
    a === 0 ||                 // 0.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 private
    (a === 192 && b === 168) ||            // 192.168.0.0/16 private
    (a === 169 && b === 254) ||            // 169.254.0.0/16 link-local / cloud metadata
    (a === 100 && b >= 64 && b <= 127)     // 100.64.0.0/10 CGNAT (RFC 6598) — also internal
  )
}

// Returns true if the IPv6 string (brackets already stripped, lowercased) is blocked.
function isBlockedIPv6(host: string): boolean {
  return (
    host === '::1' ||                     // loopback
    host.startsWith('fc') ||              // fc00::/7 ULA
    host.startsWith('fd') ||              // fc00::/7 ULA
    /^fe[89ab]/i.test(host) ||            // fe80::/10 link-local
    host.includes('::ffff:')              // IPv4-mapped — could smuggle 127.x.x.x etc.
  )
}

// Heuristic: does the hostname look like an IPv4 address?
function looksLikeIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

// Heuristic: does the hostname look like an IPv6 address (already de-bracketed)?
function looksLikeIPv6(host: string): boolean {
  return host.includes(':')
}

export function validateWebhookUrl(url: string): WebhookValidationResult {
  // Empty string means "clear" — deletion path; skip validation
  if (url === '') return { ok: true }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `protocol '${parsed.protocol}' is not allowed; use http or https` }
  }

  const host = normaliseHostname(parsed.hostname)

  if (host === 'localhost') {
    if (process.env.AGENT_DESKTOP_ALLOW_LOCAL_WEBHOOK === '1') {
      return { ok: true }
    }
    return { ok: false, reason: 'localhost is not allowed as a webhook destination' }
  }

  if (looksLikeIPv4(host)) {
    if (isBlockedIPv4(host)) {
      return { ok: false, reason: `IP address ${host} is in a blocked range (private/loopback/link-local)` }
    }
    return { ok: true }
  }

  if (looksLikeIPv6(host)) {
    if (isBlockedIPv6(host)) {
      return { ok: false, reason: `IPv6 address ${host} is in a blocked range (loopback/ULA/link-local/mapped)` }
    }
    return { ok: true }
  }

  // Hostname — not an IP literal; DNS rebinding mitigated by validateWebhookUrlAsync
  return { ok: true }
}

/**
 * Async variant that additionally resolves the hostname via DNS and applies the
 * same SSRF blocklist to the resolved IP address, mitigating DNS rebinding attacks.
 *
 * Strategy: approach B (re-resolve immediately before fetch, narrowing the TOCTOU
 * window to milliseconds). Approach A (IP-pinned fetch with TLS SNI override via
 * https.request) was rejected — it would abandon net.fetch and break test mocking.
 *
 * localhost env bypass: AGENT_DESKTOP_ALLOW_LOCAL_WEBHOOK=1 skips the resolved-IP
 * check only (the literal check in validateWebhookUrl is still enforced).
 */
export async function validateWebhookUrlAsync(url: string): Promise<WebhookValidationAsyncResult> {
  // Step 1: literal/sync check first (catches http://127.0.0.1, bad protocol, etc.)
  const syncResult = validateWebhookUrl(url)
  if (!syncResult.ok) return syncResult

  // Empty string means "clear" — no further checks needed
  if (url === '') return { ok: true, resolvedIp: '', hostname: '', family: 4 }

  const parsed = new URL(url)
  const hostname = normaliseHostname(parsed.hostname)

  // Step 2: if the hostname is already an IP literal, the sync check already vetted it.
  // Return the literal as resolvedIp with no DNS call needed.
  if (looksLikeIPv4(hostname)) {
    return { ok: true, resolvedIp: hostname, hostname, family: 4 }
  }
  if (looksLikeIPv6(hostname)) {
    return { ok: true, resolvedIp: hostname, hostname, family: 6 }
  }

  // Step 3: resolve hostname via DNS
  let resolvedIp: string
  let family: 4 | 6
  try {
    const result = await dns.promises.lookup(hostname, { family: 0 })
    resolvedIp = result.address
    family = result.family as 4 | 6
  } catch {
    return { ok: false, reason: 'DNS resolution failed' }
  }

  // Step 4: apply SSRF blocklist to the resolved IP — unless env bypass is set
  if (process.env.AGENT_DESKTOP_ALLOW_LOCAL_WEBHOOK !== '1') {
    const normalised = normaliseHostname(resolvedIp)
    if (looksLikeIPv4(normalised) && isBlockedIPv4(normalised)) {
      return { ok: false, reason: `resolved IP ${resolvedIp} matches private/blocked range` }
    }
    if (looksLikeIPv6(normalised) && isBlockedIPv6(normalised)) {
      return { ok: false, reason: `resolved IP ${resolvedIp} matches private/blocked range` }
    }
  }

  return { ok: true, resolvedIp, hostname, family }
}
