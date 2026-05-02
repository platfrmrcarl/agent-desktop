import * as http from 'http'
import { renderLoginPage } from '../../webServer/loginPage'
import {
  remoteIp,
  readRequestBody,
  parseFormBody,
  type RouteContext,
} from '../middleware'

// ─── Login / logout routes ────────────────────────────────────────────────────

/**
 * POST /login — rate-limited login form submission.
 * Rate limit check runs first, before the expensive scrypt verify.
 */
export async function handleLoginPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const ip = remoteIp(req)
  const rl = ctx.rateLimiter.check(ip)
  if (!rl.allowed) {
    res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': String(rl.retryAfterSeconds ?? 60) })
    res.end(renderLoginPage({ error: 'Too many attempts', retryAfter: rl.retryAfterSeconds }))
    return
  }
  let body = ''
  try { body = await readRequestBody(req) } catch { res.writeHead(413); res.end(); return }
  const form = parseFormBody(body)
  const ok = ctx.webPassword ? await ctx.webPassword.verifyPassword(form.password || '') : false
  ctx.rateLimiter.recordAttempt(ip, ok)
  if (!ok) {
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(renderLoginPage({ error: 'Invalid password' }))
    return
  }
  const cookie = ctx.webPassword!.issueCookie(form.remember === '1')
  const days = form.remember === '1' ? ctx.webPassword!.getRememberDurationDays() : ctx.webPassword!.getSessionDurationDays()
  const maxAge = days * 24 * 60 * 60
  const secureFlag = ctx.serverProtocol === 'https' ? ' Secure;' : ''
  res.writeHead(302, {
    'Set-Cookie': `${ctx.cookieName}=${cookie}; HttpOnly;${secureFlag} SameSite=Strict; Path=/; Max-Age=${maxAge}`,
    Location: ctx.serverShortCode ? `/s/${ctx.serverShortCode}` : '/',
  })
  res.end()
}

/**
 * POST /logout — clears the session cookie and redirects to /login.
 */
export function handleLogout(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): void {
  res.writeHead(302, {
    'Set-Cookie': `${ctx.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    Location: '/login',
  })
  res.end()
}

/**
 * GET /login — serves the login page HTML, or 404 if no password is set.
 */
export function handleLoginGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): void {
  const passwordSet = !!ctx.webPassword && ctx.webPassword.isPasswordSet()
  res.writeHead(passwordSet ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(passwordSet ? renderLoginPage({}) : 'Not found')
}
