import * as http from 'http'
import type { WebPasswordService, RateLimiter } from '../../auth'

// ─── Route context ────────────────────────────────────────────────────────────
// Bundles all per-request closure variables needed by route handlers.

export interface RouteContext {
  shimScript: string
  devUrl: string | undefined
  port: number
  rendererDir: string
  serverProtocol: 'http' | 'https'
  serverShortCode: string | null
  serverToken: string | null
  webPassword: WebPasswordService | null
  rateLimiter: RateLimiter
  cookieName: string
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function cookieIsValid(req: http.IncomingMessage, ctx: RouteContext): boolean {
  if (!ctx.webPassword || !ctx.webPassword.isPasswordSet()) return true
  const raw = getCookieValue(req.headers.cookie, ctx.cookieName)
  if (!raw) return false
  return ctx.webPassword.validateCookie(raw)
}

export function remoteIp(req: http.IncomingMessage): string {
  return req.socket.remoteAddress || ''
}

export async function readRequestBody(req: http.IncomingMessage, maxBytes = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of body.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    try { out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')) }
    catch { /* skip malformed */ }
  }
  return out
}
