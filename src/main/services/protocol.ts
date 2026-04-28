import { protocol, net } from 'electron'
import { pathToFileURL } from 'url'
import path from 'path'
import { validatePathSafe } from '../utils/validate'

/**
 * Register the agent-preview: scheme as privileged.
 * MUST be called before app.ready — Electron requires scheme registration at startup.
 */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'agent-preview',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ])
}

/**
 * Register the agent-preview: protocol handler.
 * Must be called after app.ready.
 *
 * Maps agent-preview:///absolute/path/to/file?base=/allowed/dir → reads file from disk.
 * Relative resources in HTML (CSS, images, fonts) resolve naturally
 * because the scheme is registered as "standard".
 *
 * ?base= is REQUIRED to confine reads to a specific directory subtree.
 * Without it, any compromised renderer could read user dotfiles
 * (e.g. ~/.claude/.credentials.json) via canvas pixel readback or img tags.
 */
export function registerPreviewProtocol(): void {
  protocol.handle('agent-preview', (request) => {
    let filePath: string
    let allowedBase: string
    try {
      const url = new URL(request.url)
      filePath = decodeURIComponent(url.pathname)
      const rawBase = url.searchParams.get('base')
      if (!rawBase) {
        console.warn('[agent-preview] Rejected: ?base= parameter is required', request.url)
        return new Response('Forbidden: ?base= is required', { status: 403 })
      }
      allowedBase = decodeURIComponent(rawBase)
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    // Resolve to absolute and validate — validatePathSafe with allowedBase enforces
    // both the blocked-prefix list and path-traversal confinement in one call.
    filePath = path.resolve(filePath)
    try {
      validatePathSafe(filePath, allowedBase)
    } catch (err) {
      console.warn('[agent-preview] Rejected:', (err as Error).message, request.url)
      return new Response('Forbidden', { status: 403 })
    }

    // Delegate to Electron's net module — it handles MIME detection from extension
    return net.fetch(pathToFileURL(filePath).href)
  })
}
