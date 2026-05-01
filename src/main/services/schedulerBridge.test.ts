/**
 * Tests for schedulerBridge — the Unix-socket JSON-RPC bridge that lets the
 * scheduler MCP server talk back to Electron's DB without spawning a sibling
 * sql.js process.
 *
 * Why direct: the only existing coverage was via mocks in streamingPI.test.ts.
 * That meant socket auth, lifecycle, and cleanup had zero observable assertions.
 * These tests exercise a real `net.createServer` listening on a tmpdir socket
 * and connect with `net.createConnection`.
 *
 * What's mocked vs real:
 *   - real: net.Server, net.Socket, fs (socket file lifecycle), the JSON
 *     line protocol, a real sql.js DB via createTestDb()
 *   - mocked: electron app (just for getPath), getMainWindow, broadcast (no-op)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as net from 'net'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TMP_RUNTIME = fs.mkdtempSync(path.join(os.tmpdir(), 'schedbridge-test-'))

// Pin XDG_RUNTIME_DIR before the module loads so getSocketPath resolves under tmp.
process.env.XDG_RUNTIME_DIR = TMP_RUNTIME

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => TMP_RUNTIME),
    isPackaged: false,
    getAppPath: vi.fn(() => TMP_RUNTIME),
  },
}))

vi.mock('../index', () => ({ getMainWindow: vi.fn(() => null) }))
vi.mock('../mainContext', () => ({
  getMainWindow: vi.fn(() => null),
}))

const broadcastSpy = vi.fn()
vi.mock('../utils/broadcast', () => ({
  broadcast: (...args: unknown[]) => broadcastSpy(...args),
}))

// findBinaryInPath / getSchedulerMcpConfig — real, but we'll just trust path lookup.
import { startBridge, stopBridge, getSchedulerMcpConfig, socketPath as exportedSocketPath, authToken as exportedAuthToken } from './schedulerBridge'
import { createTestDb } from '../__tests__/db-helper'
import type Database from 'better-sqlite3'

interface BridgeResponse {
  id: string | number | null
  result?: unknown
  error?: string
}

/** Connect to the running bridge, send one JSON-line request, return the parsed reply. */
function rpc(socketPath: string, payload: Record<string, unknown>): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const conn = net.createConnection(socketPath)
    let buf = ''
    const timer = setTimeout(() => {
      conn.destroy()
      reject(new Error('rpc timeout'))
    }, 2000)
    conn.on('data', (chunk) => {
      buf += chunk.toString()
      const idx = buf.indexOf('\n')
      if (idx !== -1) {
        clearTimeout(timer)
        const line = buf.slice(0, idx)
        conn.end()
        try { resolve(JSON.parse(line)) } catch (e) { reject(e) }
      }
    })
    conn.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    conn.write(JSON.stringify(payload) + '\n')
  })
}

/** Re-read the live module exports (token rotates per startBridge call). */
async function currentBridgeState(): Promise<{ socketPath: string; token: string }> {
  // Re-import to refresh the live values of socketPath/authToken; they're
  // exported as module-level `let` bindings that mutate after startBridge().
  const mod = await import('./schedulerBridge')
  if (!mod.socketPath || !mod.authToken) throw new Error('bridge not started')
  return { socketPath: mod.socketPath, token: mod.authToken }
}

describe('schedulerBridge', () => {
  let db: Database.Database
  let convId: number

  beforeEach(async () => {
    db = await createTestDb() as unknown as Database.Database
    // Seed a conversation the bridge can target
    const r = (db as any).prepare(
      "INSERT INTO conversations (title, model, updated_at) VALUES ('Bridge Test', 'claude-sonnet-4-6', datetime('now'))"
    ).run()
    convId = r.lastInsertRowid as number
    broadcastSpy.mockClear()
  })

  afterEach(() => {
    stopBridge()
    db.close()
  })

  describe('lifecycle', () => {
    it('startBridge creates the socket file and sets owner-only perms', async () => {
      startBridge(db)
      const { socketPath } = await currentBridgeState()

      // The server.listen() callback chmods async; wait briefly for it.
      await new Promise<void>((resolve) => setTimeout(resolve, 50))

      expect(fs.existsSync(socketPath)).toBe(true)
      const stat = fs.statSync(socketPath)
      // 0o600 — owner read+write, no group/other perms (low 9 bits only)
      expect(stat.mode & 0o777).toBe(0o600)
    })

    it('stopBridge removes the socket file and clears credentials', async () => {
      startBridge(db)
      const { socketPath } = await currentBridgeState()
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      expect(fs.existsSync(socketPath)).toBe(true)

      stopBridge()

      expect(fs.existsSync(socketPath)).toBe(false)
      // Re-import: exports reset to null
      const mod = await import('./schedulerBridge')
      expect(mod.socketPath).toBeNull()
      expect(mod.authToken).toBeNull()
    })

    it('startBridge replaces a stale socket file from a prior process', async () => {
      // Simulate a stale socket left behind by a crashed prior instance.
      const stale = path.join(TMP_RUNTIME, `agent-desktop-sched-${process.pid}.sock`)
      try { fs.writeFileSync(stale, 'leftover') } catch { /* ignore */ }

      startBridge(db)
      await new Promise<void>((resolve) => setTimeout(resolve, 50))

      // The stale file is gone, replaced by a real socket.
      expect(fs.existsSync(stale)).toBe(true)
      expect(fs.statSync(stale).isSocket()).toBe(true)
    })

    it('issues a fresh authToken on every startBridge call', async () => {
      startBridge(db)
      const a = (await currentBridgeState()).token
      stopBridge()
      startBridge(db)
      const b = (await currentBridgeState()).token
      expect(a).toBeTruthy()
      expect(b).toBeTruthy()
      expect(a).not.toBe(b)
    })
  })

  describe('authentication', () => {
    it('rejects requests with no token', async () => {
      startBridge(db)
      const { socketPath } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 1,
        method: 'scheduler.list',
        params: { conversation_id: convId },
      })

      expect(reply.error).toBeDefined()
      expect(reply.error).toMatch(/Unauthorized/)
      expect(reply.result).toBeUndefined()
    })

    it('rejects requests with a wrong token', async () => {
      startBridge(db)
      const { socketPath } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 2,
        method: 'scheduler.list',
        token: 'definitely-not-the-real-token',
        params: { conversation_id: convId },
      })

      expect(reply.error).toMatch(/Unauthorized/)
    })

    it('accepts requests with the correct token', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 3,
        method: 'scheduler.list',
        token,
        params: { conversation_id: convId },
      })

      expect(reply.error).toBeUndefined()
      expect(Array.isArray(reply.result)).toBe(true)
      expect(reply.id).toBe(3)
    })
  })

  describe('dispatch — scheduler.create', () => {
    it('creates a task targeting an existing conversation', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'a',
        method: 'scheduler.create',
        token,
        params: {
          name: 'Test Task',
          prompt: 'do the thing',
          conversation_id: convId,
          interval_value: 30,
          interval_unit: 'minutes',
        },
      })

      expect(reply.error).toBeUndefined()
      expect(reply.result).toMatchObject({ name: 'Test Task' })
      const result = reply.result as { id: number; next_run_at: string }
      expect(typeof result.id).toBe('number')
      expect(typeof result.next_run_at).toBe('string')

      // Persisted to DB
      const row = (db as any).prepare('SELECT name, conversation_id FROM scheduled_tasks WHERE id = ?').get(result.id) as { name: string; conversation_id: number }
      expect(row.name).toBe('Test Task')
      expect(row.conversation_id).toBe(convId)
    })

    it('rejects scheduler.create when the conversation does not exist', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'b',
        method: 'scheduler.create',
        token,
        params: {
          name: 'Orphan',
          prompt: 'no conv',
          conversation_id: 99999,
          interval_value: 1,
          interval_unit: 'hours',
        },
      })

      expect(reply.error).toMatch(/Conversation not found/)
    })

    it('rejects non-positive conversation_id', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'c',
        method: 'scheduler.create',
        token,
        params: {
          name: 'Bad', prompt: 'x', conversation_id: 0,
          interval_value: 5, interval_unit: 'minutes',
        },
      })

      expect(reply.error).toMatch(/conversation_id/)
    })
  })

  describe('dispatch — scheduler.list', () => {
    it('returns rows scoped to the conversation, with prompt truncated to 200 chars', async () => {
      // Pre-seed a task with a long prompt
      const longPrompt = 'x'.repeat(500)
      ;(db as any).prepare(
        `INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, NULL, 1, 0, 'none', datetime('now'), datetime('now'), datetime('now'))`
      ).run('Long', longPrompt, convId, 10, 'minutes')

      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'd', method: 'scheduler.list', token,
        params: { conversation_id: convId },
      })

      const rows = reply.result as Array<{ name: string; prompt: string; enabled: boolean }>
      expect(Array.isArray(rows)).toBe(true)
      const row = rows.find(r => r.name === 'Long')
      expect(row).toBeDefined()
      expect(row!.prompt.length).toBe(200)
      expect(row!.prompt).toBe('x'.repeat(200))
      expect(typeof row!.enabled).toBe('boolean')
    })

    it('does not include tasks belonging to other conversations', async () => {
      const r2 = (db as any).prepare(
        "INSERT INTO conversations (title, model, updated_at) VALUES ('Other', 'claude-sonnet-4-6', datetime('now'))"
      ).run()
      const otherConv = r2.lastInsertRowid as number
      ;(db as any).prepare(
        `INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action, next_run_at, created_at, updated_at)
         VALUES ('Other Task', 'p', ?, 5, 'minutes', NULL, 0, NULL, 1, 0, 'none', datetime('now'), datetime('now'), datetime('now'))`
      ).run(otherConv)

      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'e', method: 'scheduler.list', token,
        params: { conversation_id: convId },
      })
      const rows = reply.result as Array<{ name: string }>
      expect(rows.find(r => r.name === 'Other Task')).toBeUndefined()
    })
  })

  describe('dispatch — scheduler.cancel', () => {
    it('deletes a task that belongs to the caller conversation', async () => {
      const ins = (db as any).prepare(
        `INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action, next_run_at, created_at, updated_at)
         VALUES ('To Cancel', 'p', ?, 5, 'minutes', NULL, 0, NULL, 1, 0, 'none', datetime('now'), datetime('now'), datetime('now'))`
      ).run(convId)
      const taskId = ins.lastInsertRowid as number

      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'f', method: 'scheduler.cancel', token,
        params: { task_id: taskId, conversation_id: convId },
      })

      expect(reply.error).toBeUndefined()
      expect(reply.result).toEqual({ deleted: true })

      const remaining = (db as any).prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(taskId)
      expect(remaining).toBeUndefined()
    })

    it('refuses to cancel a task that belongs to a different conversation', async () => {
      const r2 = (db as any).prepare(
        "INSERT INTO conversations (title, model, updated_at) VALUES ('Other', 'claude-sonnet-4-6', datetime('now'))"
      ).run()
      const otherConv = r2.lastInsertRowid as number
      const ins = (db as any).prepare(
        `INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit, schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action, next_run_at, created_at, updated_at)
         VALUES ('Theirs', 'p', ?, 5, 'minutes', NULL, 0, NULL, 1, 0, 'none', datetime('now'), datetime('now'), datetime('now'))`
      ).run(otherConv)
      const foreignTaskId = ins.lastInsertRowid as number

      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'g', method: 'scheduler.cancel', token,
        params: { task_id: foreignTaskId, conversation_id: convId },
      })

      expect(reply.error).toMatch(/another conversation/)

      // Sanity: foreign task survived
      const stillThere = (db as any).prepare('SELECT id FROM scheduled_tasks WHERE id = ?').get(foreignTaskId)
      expect(stillThere).toBeDefined()
    })
  })

  describe('dispatch — protocol & errors', () => {
    it('rejects an unknown method', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const reply = await rpc(socketPath, {
        id: 'h', method: 'scheduler.bogus', token,
        params: {},
      })
      expect(reply.error).toMatch(/Unknown method/)
    })

    it('returns an error envelope for malformed JSON instead of crashing the connection', async () => {
      startBridge(db)
      const { socketPath } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const conn = net.createConnection(socketPath)
      const reply: string = await new Promise((resolve, reject) => {
        let buf = ''
        const t = setTimeout(() => { conn.destroy(); reject(new Error('timeout')) }, 2000)
        conn.on('data', (c) => {
          buf += c.toString()
          const i = buf.indexOf('\n')
          if (i !== -1) { clearTimeout(t); conn.end(); resolve(buf.slice(0, i)) }
        })
        conn.on('error', (e) => { clearTimeout(t); reject(e) })
        conn.write('this is not json\n')
      })

      const parsed = JSON.parse(reply) as BridgeResponse
      expect(parsed.error).toBeDefined()
      expect(parsed.id).toBeNull()
    })

    it('handles two requests on the same connection (newline framing)', async () => {
      startBridge(db)
      const { socketPath, token } = await currentBridgeState()
      await new Promise<void>((r) => setTimeout(r, 50))

      const conn = net.createConnection(socketPath)
      const replies: BridgeResponse[] = []
      const got = new Promise<void>((resolve, reject) => {
        let buf = ''
        const t = setTimeout(() => { conn.destroy(); reject(new Error('timeout')) }, 2500)
        conn.on('data', (c) => {
          buf += c.toString()
          let idx
          while ((idx = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, idx)
            buf = buf.slice(idx + 1)
            replies.push(JSON.parse(line))
            if (replies.length === 2) { clearTimeout(t); conn.end(); resolve() }
          }
        })
        conn.on('error', (e) => { clearTimeout(t); reject(e) })
      })

      conn.write(JSON.stringify({ id: 'r1', method: 'scheduler.list', token, params: { conversation_id: convId } }) + '\n')
      conn.write(JSON.stringify({ id: 'r2', method: 'scheduler.bogus', token, params: {} }) + '\n')

      await got
      // Protocol detail: success replies preserve req.id, but error replies
      // come back with id: null (the catch block in dispatch loses the id).
      // We assert that BOTH frames arrived and are correctly shaped.
      expect(replies.length).toBe(2)
      const success = replies.find(r => r.id === 'r1')
      const failure = replies.find(r => r.id === null)
      expect(success?.error).toBeUndefined()
      expect(Array.isArray(success?.result)).toBe(true)
      expect(failure?.error).toMatch(/Unknown method/)
    })
  })

  describe('getSchedulerMcpConfig', () => {
    it('returns null when bridge has not been started', async () => {
      // Bridge is not started in this test (no startBridge call before).
      const cfg = getSchedulerMcpConfig(convId)
      expect(cfg).toBeNull()
    })

    it('returns null when MCP script is missing (unpackaged + no resources/mcp dir)', async () => {
      // We're in test mode (electron mocked, getAppPath() → tmpdir), so the
      // bundled scheduler-server.mjs script does not exist. The factory must
      // fail closed rather than returning a half-formed config.
      startBridge(db)
      await new Promise<void>((r) => setTimeout(r, 50))
      const cfg = getSchedulerMcpConfig(convId)
      expect(cfg).toBeNull()
    })
  })

  describe('exported credentials', () => {
    it('socketPath and authToken modules-exports update after startBridge', async () => {
      // Before start, the originally-imported bindings are null (proven via re-import).
      const before = await import('./schedulerBridge')
      // Could be from a prior test's startBridge — stop to make sure.
      stopBridge()
      const cleared = await import('./schedulerBridge')
      expect(cleared.socketPath).toBeNull()
      expect(cleared.authToken).toBeNull()
      // Suppress unused-var warning for the guard import
      void before

      startBridge(db)
      const after = await import('./schedulerBridge')
      expect(typeof after.socketPath).toBe('string')
      expect(typeof after.authToken).toBe('string')
      expect(after.authToken!.length).toBeGreaterThan(0)
    })

    it('top-of-file imports of socketPath/authToken are live ESM bindings (null after stopBridge)', () => {
      // The top-of-file `import { socketPath, authToken }` captures live
      // ESM bindings — they should reflect post-stop state without re-import.
      stopBridge()
      expect(exportedSocketPath).toBeNull()
      expect(exportedAuthToken).toBeNull()
    })
  })
})
