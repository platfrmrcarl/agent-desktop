import { describe, it, expect } from 'vitest'
import { createMcpClient } from './mcpClient'
import type { McpClientHandle } from './mcpClient'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(fixtureDir, '__fixtures__', 'mockMcpServer.ts')

describe('mcpClient — integration with real stdio MCP server', () => {
  it('connects, lists tools, calls echo, closes cleanly', async () => {
    let handle: McpClientHandle | undefined
    try {
      handle = await createMcpClient('mock', {
        command: 'npx',
        args: ['tsx', fixturePath],
      })

      expect(handle.tools).toHaveLength(1)
      expect(handle.tools[0].name).toBe('echo')
      expect(handle.tools[0].description).toBe('Echo the input text')

      const result = (await handle.callTool('echo', { text: 'hello' })) as {
        content: Array<{ type: string; text: string }>
      }
      expect(result).toMatchObject({
        content: [{ type: 'text', text: 'echo: hello' }],
      })
    } finally {
      await handle?.close()
    }
  }, 20_000)
})
