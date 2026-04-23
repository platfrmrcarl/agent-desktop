#!/usr/bin/env node
// Minimal MCP stdio server for integration tests. Implements the bare
// JSON-RPC surface the @modelcontextprotocol/sdk client needs: initialize,
// notifications/initialized, tools/list, tools/call.

import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin })

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  let req: { jsonrpc: string; id?: number; method: string; params?: unknown }
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  if (req.method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '0.0.1' },
      },
    })
  }
  if (req.method === 'initialized' || req.method === 'notifications/initialized') {
    return // notification, no response
  }
  if (req.method === 'tools/list') {
    return send({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo the input text',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      },
    })
  }
  if (req.method === 'tools/call') {
    const args = (req.params as { arguments?: { text?: string } })?.arguments ?? {}
    return send({
      jsonrpc: '2.0',
      id: req.id,
      result: { content: [{ type: 'text', text: `echo: ${args.text ?? ''}` }] },
    })
  }
  send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'method not found' } })
})

// Exit cleanly when stdin closes (client side closed the transport).
rl.on('close', () => process.exit(0))
