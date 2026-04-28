/**
 * Real-headless integration test.
 *
 * Spawns the actual headless bundle (`out/headless/index.js --server`) as a
 * child process, waits for the server to advertise its URL on stdout, hits it
 * with HTTP GET, asserts the redirect-to-HTTPS contract, then kills.
 *
 * Requires the bundle to exist — run `npm run build:headless` first.
 * Tests that depend on the bundle SKIP (rather than fail) if it's absent, so
 * fresh checkouts don't get a misleading red.
 *
 * Test isolation:
 *   - AGENT_DB_PATH points to a per-run temp DB (no pollution of user data).
 *   - AGENT_THEMES_DIR points to a per-run temp dir.
 *   - --port uses a high range to minimize clashes with dev or other tests.
 *   - SSL dir is intentionally NOT overridden — it's shared with the user's
 *     install, but cert files are reused (idempotent), not mutated per run.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'

const BUNDLE_PATH = join(process.cwd(), 'out', 'headless', 'index.js')
const BUNDLE_AVAILABLE = existsSync(BUNDLE_PATH)

// High port to avoid clashes with dev (3484) and other test runs.
const TEST_PORT = 30000 + Math.floor(Math.random() * 20000)

interface ServerInfo {
  url: string
  token: string
}

function parseServerInfo(stdout: string): ServerInfo | null {
  const urlMatch = stdout.match(/Web server running at (https?:\/\/\S+)/)
  const tokenMatch = stdout.match(/Access token: ([a-f0-9]+)/)
  if (!urlMatch || !tokenMatch) return null
  return { url: urlMatch[1], token: tokenMatch[1] }
}

function httpGet(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      // Drain to avoid leaks; we only care about status + headers.
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

const skipIfNoBundle = BUNDLE_AVAILABLE ? describe : describe.skip

skipIfNoBundle('headless --server (integration)', () => {
  let child: ChildProcess | null = null
  let serverInfo: ServerInfo | null = null
  let tempDbDir: string
  let tempThemesDir: string
  let stdoutBuffer = ''
  let stderrBuffer = ''

  beforeAll(async () => {
    tempDbDir = mkdtempSync(join(tmpdir(), 'agent-headless-it-db-'))
    tempThemesDir = mkdtempSync(join(tmpdir(), 'agent-headless-it-themes-'))

    child = spawn(process.execPath, [BUNDLE_PATH, '--server', '--port', String(TEST_PORT)], {
      env: {
        ...process.env,
        AGENT_DB_PATH: join(tempDbDir, 'agent-test.db'),
        AGENT_THEMES_DIR: tempThemesDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      if (!serverInfo) serverInfo = parseServerInfo(stdoutBuffer)
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
    })

    // Wait up to 15s for the server to advertise its URL on stdout.
    const deadline = Date.now() + 15_000
    while (!serverInfo && Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Headless exited prematurely (code ${child.exitCode}).\n` +
          `STDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`
        )
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    if (!serverInfo) {
      throw new Error(
        `Headless did not advertise server URL within 15s.\n` +
        `STDOUT:\n${stdoutBuffer}\nSTDERR:\n${stderrBuffer}`
      )
    }
  }, 30_000)

  afterAll(() => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      // best-effort: don't await — vitest's process cleanup catches lingering children
    }
    if (tempDbDir) rmSync(tempDbDir, { recursive: true, force: true })
    if (tempThemesDir) rmSync(tempThemesDir, { recursive: true, force: true })
  })

  it('advertises a server URL and access token on stdout', () => {
    expect(serverInfo).not.toBeNull()
    expect(serverInfo!.url).toMatch(/^https?:\/\//)
    expect(serverInfo!.token).toMatch(/^[a-f0-9]+$/)
    expect(serverInfo!.token.length).toBeGreaterThanOrEqual(16)
  })

  // The webServer enables HTTPS-by-default with an HTTP→HTTPS redirect on the
  // same port. A plain HTTP request must therefore receive a 301/308.
  // (CLAUDE.md: "HTTPS, HTTP→HTTPS redirect enabled")
  it('serves an HTTP→HTTPS redirect on the bound port', async () => {
    const res = await httpGet(`http://127.0.0.1:${TEST_PORT}/`)
    expect([301, 308]).toContain(res.status)
    const location = res.headers.location
    expect(typeof location === 'string' ? location : '').toMatch(/^https:\/\//)
  })

  it('logs Engine init and conversations count', () => {
    expect(stdoutBuffer).toMatch(/Starting Agent Engine/)
    expect(stdoutBuffer).toMatch(/Engine initialized\. \d+ conversations in DB/)
  })
})
