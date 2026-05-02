import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import type { RouteContext } from '../middleware'
import { createLogger } from '../../../utils/logger'

const log = createLogger('webServer.static')

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
}

// Inject <base href="/"> so relative asset paths resolve from root (not /s/)
const BASE_TAG = '<base href="/">'

// ─── Static file helpers ──────────────────────────────────────────────────────

function serveStaticFile(
  reqPath: string,
  res: http.ServerResponse,
  shimScript: string,
  rendererDir: string,
): void {
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.join(rendererDir, safePath === '/' ? 'index.html' : safePath)

  if (!filePath.startsWith(rendererDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (safePath !== '/' && !path.extname(safePath)) {
        serveStaticFile('/', res, shimScript, rendererDir)
        return
      }
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME[ext] || 'application/octet-stream'

    if (ext === '.html') {
      let html = data.toString('utf-8')
      html = html.replace('</head>', `<script>${shimScript}</script>\n</head>`)
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(html)
      return
    }

    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  })
}

function serveStaticWithTokenInjection(
  res: http.ServerResponse,
  shimScript: string,
  tokenScript: string,
  rendererDir: string,
): void {
  const filePath = path.join(rendererDir, 'index.html')
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    let html = data.toString('utf-8')
    html = html.replace('<head>', `<head>${BASE_TAG}`)
    html = html.replace('</head>', `${tokenScript}<script>${shimScript}</script>\n</head>`)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })
}

// ─── Dev proxy helpers ────────────────────────────────────────────────────────

function proxyToDev(
  devUrl: string,
  pathname: string,
  res: http.ServerResponse,
  shimScript: string,
): void {
  const target = new URL(pathname, devUrl)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const proto = target.protocol === 'https:' ? require('https') : require('http')

  proto.get(target.href, (proxyRes: http.IncomingMessage) => {
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks)
      const contentType = proxyRes.headers['content-type'] || ''
      if (contentType.includes('text/html')) {
        let html = body.toString('utf-8')
        html = html.replace('</head>', `<script>${shimScript}</script>\n</head>`)
        res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': contentType })
        res.end(html)
      } else {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
        res.end(body)
      }
    })
  }).on('error', (err: Error) => {
    log.error('Dev proxy error', err)
    res.writeHead(502)
    res.end('Dev server not reachable')
  })
}

function proxyToDevWithTokenInjection(
  devUrl: string,
  res: http.ServerResponse,
  shimScript: string,
  tokenScript: string,
): void {
  const target = new URL('/', devUrl)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const proto = target.protocol === 'https:' ? require('https') : require('http')

  proto.get(target.href, (proxyRes: http.IncomingMessage) => {
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const body = Buffer.concat(chunks)
      let html = body.toString('utf-8')
      html = html.replace('<head>', `<head>${BASE_TAG}`)
      html = html.replace('</head>', `${tokenScript}<script>${shimScript}</script>\n</head>`)
      res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })
  }).on('error', (err: Error) => {
    log.error('Dev proxy error', err)
    res.writeHead(502)
    res.end('Dev server not reachable')
  })
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/**
 * GET /agent-ws-shim.js — serves the WebSocket shim JS inline (no disk read).
 * Served before the cookie gate so clients can bootstrap the WS connection.
 */
export function handleShimJs(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): void {
  res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
  res.end(ctx.shimScript)
}

/**
 * GET /s/:code — short-code entry point. Serves index.html with token injection.
 */
export function handleShortCode(
  shortCode: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): void {
  if (shortCode !== ctx.serverShortCode) {
    res.writeHead(403)
    res.end('Invalid short code')
    return
  }
  const passwordSet = !!ctx.webPassword && ctx.webPassword.isPasswordSet()
  const tokenScript = passwordSet ? '' : `<script>window.__AGENT_TOKEN__=${JSON.stringify(ctx.serverToken)};</script>`
  if (ctx.devUrl) proxyToDevWithTokenInjection(ctx.devUrl, res, ctx.shimScript, tokenScript)
  else serveStaticWithTokenInjection(res, ctx.shimScript, tokenScript, ctx.rendererDir)
}

/**
 * Fallback: serve static assets or proxy to dev server.
 */
export function handleStatic(
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: RouteContext,
): void {
  if (ctx.devUrl) proxyToDev(ctx.devUrl, pathname, res, ctx.shimScript)
  else serveStaticFile(pathname, res, ctx.shimScript, ctx.rendererDir)
}
