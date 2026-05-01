/* eslint-disable no-console */
// Mini WS livetest against the headless server.
// Verifies that conversations:list, settings:get, folders:list, themes:list
// all route through the IPC dispatch and return data — exercises the full
// AgentEngine + DB + dispatch chain that consumes our refactored streaming.ts
// at engine init time.
//
// Usage: node scripts/ws-livetest.mjs <token> <url-path>
//   e.g. node scripts/ws-livetest.mjs 7f9ec... /s/XDrPqC8G

import WebSocket from 'ws'

const TOKEN = process.argv[2]
const PORT = process.argv[3] || '3499'
if (!TOKEN) {
  console.error('Usage: node scripts/ws-livetest.mjs <token> [port]')
  process.exit(1)
}

const wsUrl = `wss://127.0.0.1:${PORT}/ws`
const ws = new WebSocket(wsUrl, { rejectUnauthorized: false })
let authenticated = false

let nextId = 1
const pending = new Map()
const events = []

ws.on('open', () => {
  console.log('[client] WS connected, sending auth')
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }))
})

async function runChannels() {
  let allOk = true
  const channels = [
    ['conversations:list', {}],
    ['settings:get', {}],
    ['folders:list', {}],
    ['themes:list', {}],
  ]
  for (const [channel, args] of channels) {
    try {
      const result = await call(channel, args)
      const repr = JSON.stringify(result) || '(undefined)'
      console.log(`[client] OK  ${channel} → ${repr.slice(0, 200)}`)
    } catch (err) {
      console.error(`[client] FAIL ${channel} → ${err.message}`)
      allOk = false
    }
  }
  console.log(`[client] Done. Events received: ${events.length}. Status: ${allOk ? 'PASS' : 'FAIL'}`)
  ws.close()
  process.exit(allOk ? 0 : 2)
}

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString())
  if (msg.type === 'auth_result') {
    if (msg.success) {
      authenticated = true
      console.log('[client] Auth OK, running channel calls')
      runChannels()
    } else {
      console.error('[client] Auth FAILED:', msg.error || 'unknown')
      process.exit(4)
    }
    return
  }
  if (msg.type === 'result' && msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error))
    else resolve(msg.result)
    return
  }
  events.push(msg)
})

ws.on('close', (code, reason) => {
  console.log(`[client] WS closed (${code}) ${reason ? reason.toString() : ''}`)
})

ws.on('error', (err) => {
  console.error('[client] WS error:', err.message || err)
  process.exit(3)
})

function call(channel, args) {
  return new Promise((resolve, reject) => {
    const id = String(nextId++)
    pending.set(id, { resolve, reject })
    // server expects an args ARRAY (positional); pass as [args] to invoke handler(args)
    const argsArr = Array.isArray(args) ? args : [args]
    ws.send(JSON.stringify({ type: 'invoke', id, channel, args: argsArr }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`timeout on ${channel}`))
      }
    }, 5000)
  })
}
