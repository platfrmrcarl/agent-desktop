import * as http from 'http'
import type { Duplex } from 'stream'
import type { WebSocketServer, WebSocket } from 'ws'
import { getCookieValue, cookieIsValid, type RouteContext } from '../middleware'

// ─── WebSocket upgrade handler ────────────────────────────────────────────────

export interface WsUpgradeContext extends RouteContext {
  wss: WebSocketServer
  authenticatedClients: Set<WebSocket>
  clientCookies: WeakMap<WebSocket, string>
  isAllowedRemote: (addr: string | undefined) => boolean
}

/**
 * Handles the HTTP upgrade to WebSocket.
 * - Enforces LAN/remote allowlist
 * - Enforces cookie auth when password is set (cookie validated before accepting upgrade)
 * - Auto-authenticates cookie-authed clients and stores cookie for heartbeat re-validation
 * - Proxies dev-server WS upgrades in development mode
 */
export function handleWsUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ctx: WsUpgradeContext,
): void {
  if (!ctx.isAllowedRemote(req.socket.remoteAddress)) {
    socket.destroy()
    return
  }

  const passwordSet = !!ctx.webPassword && ctx.webPassword.isPasswordSet()
  if (passwordSet && !cookieIsValid(req, ctx)) {
    socket.destroy()
    return
  }

  const url = new URL(req.url || '/', `http://localhost:${ctx.port}`)

  if (url.pathname === '/ws') {
    ctx.wss.handleUpgrade(req, socket, head, (wsClient) => {
      if (passwordSet) {
        ctx.authenticatedClients.add(wsClient)
        const cookieVal = getCookieValue(req.headers.cookie, ctx.cookieName)
        if (cookieVal) ctx.clientCookies.set(wsClient, cookieVal)
      }
      ctx.wss.emit('connection', wsClient, req)
    })
    return
  }

  if (ctx.devUrl) {
    proxyDevWsUpgrade(req, socket, head, ctx.devUrl)
    return
  }

  socket.destroy()
}

function proxyDevWsUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  devUrl: string,
): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http_ = require('http') as typeof http
  const target = new URL(devUrl)
  const proxyReq = http_.request({
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    headers: req.headers,
    method: req.method,
  })
  proxyReq.on('upgrade', (_proxyRes: http.IncomingMessage, proxySocket: Duplex, proxyHead: Buffer) => {
    let response = 'HTTP/1.1 101 Switching Protocols\r\n'
    for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
      response += _proxyRes.rawHeaders[i] + ': ' + _proxyRes.rawHeaders[i + 1] + '\r\n'
    }
    response += '\r\n'
    socket.write(response)
    if (proxyHead.length) socket.write(proxyHead)
    if (head.length) proxySocket.write(head)
    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
    socket.on('error', () => proxySocket.destroy())
    proxySocket.on('error', () => socket.destroy())
  })
  proxyReq.on('error', () => socket.destroy())
  proxyReq.end()
}
