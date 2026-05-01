/**
 * Branch-coverage tests for sessionManager.ts internal handlers:
 *   - handleStreamEvent  (CRAP 930, cyclomatic 30)
 *   - handleResultMessage (CRAP 870, cyclomatic 29)
 *   - handleSystemMessage (CRAP 272, cyclomatic 16)
 *
 * These functions are private — exercised via the public sendTurn() API by
 * crafting SDK message streams that hit each branch. Mocks mirror the pattern
 * in sessionManager.test.ts (vi.hoisted streamingMockExports).
 *
 * NOTE: `done` chunks may carry stopReason/resultSubtype. We assert presence,
 * not exact extras, where the codepath bears multiple inputs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks (must come before importing sessionManager) ────────

vi.mock('./anthropic', () => ({
  loadAgentSDK: vi.fn(),
}))

const streamingMockExports = vi.hoisted(() => ({
  sendChunk: vi.fn(),
  abortControllers: new Map(),
  respondToApproval: vi.fn(),
  buildPromptWithHistory: vi.fn((msgs: Array<{ content: string }>) => msgs.map((m) => m.content).join('\n')),
  injectApiKeyEnv: vi.fn(() => null),
}))
vi.mock('./streaming', () => streamingMockExports)
vi.mock('../../core/services/streaming', () => streamingMockExports)

vi.mock('./cwdHooks', () => ({
  buildCwdRestrictionHooks: vi.fn(() => ({})),
}))

vi.mock('../utils/env', () => ({
  findBinaryInPath: vi.fn(() => '/usr/bin/node'),
  ensureFreshMacOSToken: vi.fn(async () => {}),
}))

// ─── Helpers ──────────────────────────────────────────────────

type SDKMessage = Record<string, unknown>

/** Build a mock SDK query that yields a fixed list of messages, then blocks.
 * `firstDelayMs` adds an await before the very first message so currentTurn
 * is reliably set by sendTurn before the within-turn dispatch starts. */
function makeQuery(messages: SDKMessage[], firstDelayMs = 5) {
  let idx = 0
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        if (idx === 0 && firstDelayMs > 0) {
          await new Promise<void>((r) => setTimeout(r, firstDelayMs))
        }
        if (idx < messages.length) return { value: messages[idx++], done: false }
        // Block forever — keeps session alive after final message
        return new Promise<{ value: undefined; done: true }>(() => {})
      },
    }),
    close: vi.fn(),
  }
}

/** Build a query that yields all messages then ends naturally (causes reconnect). */
function makeQueryThatEnds(messages: SDKMessage[]) {
  let idx = 0
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        if (idx < messages.length) return { value: messages[idx++], done: false }
        return { value: undefined, done: true }
      },
    }),
    close: vi.fn(),
  }
}

const baseAiSettings = {
  model: 'claude-sonnet-4-20250514',
  cwd: '/tmp/test',
  permissionMode: 'bypassPermissions',
}

// ─── Test setup ───────────────────────────────────────────────

describe('sessionManager handlers (branch coverage)', () => {
  let sessionManager: typeof import('./sessionManager')
  let mockSdk: { query: ReturnType<typeof vi.fn> }
  let convCounter = 1000
  const allocConv = () => ++convCounter

  beforeEach(async () => {
    vi.resetModules()
    sessionManager = await import('./sessionManager')
    const anthropic = await import('./anthropic')

    mockSdk = { query: vi.fn() }
    vi.mocked(anthropic.loadAgentSDK).mockResolvedValue(mockSdk as never)
    streamingMockExports.sendChunk.mockClear()
    streamingMockExports.abortControllers.clear()
  })

  afterEach(() => {
    sessionManager.shutdownAllSessions()
  })

  // ─── handleStreamEvent branches ────────────────────────────

  describe('handleStreamEvent', () => {
    it('text_delta: appends to turn.content and emits text chunk', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's1' },
        { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } },
        { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's1' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'hi' }], 'sys', baseAiSettings as never, null)
      expect(result.content).toBe('Hello world')

      const textCalls = streamingMockExports.sendChunk.mock.calls.filter((c) => c[0] === 'text' && c[1])
      expect(textCalls.map((c) => c[1])).toEqual(['Hello ', 'world'])
    })

    it('text_delta: empty text is ignored (falsy guard)', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's1' },
        // empty text — should NOT emit a text chunk, content unchanged
        { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } } },
        { type: 'stream_event', session_id: 's1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'real' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's1' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'hi' }], 'sys', baseAiSettings as never, null)
      expect(result.content).toBe('real')
    })

    it('content_block_start tool_use: emits tool_start and registers in toolCallsMap', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's2' },
        { type: 'stream_event', session_id: 's2', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_1', name: 'Read' } } },
        { type: 'stream_event', session_id: 's2', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' } } },
        { type: 'stream_event', session_id: 's2', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's2' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'read' }], 'sys', baseAiSettings as never, null)

      const toolStartCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'tool_start')
      expect(toolStartCall).toBeDefined()
      expect(toolStartCall?.[1]).toBe('Read')
      expect((toolStartCall?.[2] as Record<string, unknown>).toolId).toBe('tool_1')

      const toolInputCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'tool_input')
      expect(toolInputCall).toBeDefined()
      expect((toolInputCall?.[2] as Record<string, unknown>).toolInput).toBe('{"path":"a"}')

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('Read')
      expect(result.toolCalls[0].input).toBe('{"path":"a"}')
    })

    it('content_block_start tool_use without id falls back to synthetic id', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's2b' },
        // no id, no name → fallback paths in handler
        { type: 'stream_event', session_id: 's2b', event: { type: 'content_block_start', content_block: { type: 'tool_use' } } },
        { type: 'stream_event', session_id: 's2b', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's2b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)

      const toolStartCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'tool_start')
      expect(toolStartCall).toBeDefined()
      // Fallback name = 'tool', synthetic id starts with tool_
      expect(toolStartCall?.[1]).toBe('tool')
      const extra = toolStartCall?.[2] as Record<string, unknown>
      expect(typeof extra.toolId).toBe('string')
      expect((extra.toolId as string).startsWith('tool_')).toBe(true)
      expect(result.toolCalls).toHaveLength(1)
    })

    it('AskUserQuestion tool_use: NOT emitted as tool_start; tracked in askUserToolIds', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's3' },
        { type: 'stream_event', session_id: 's3', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'ask_1', name: 'AskUserQuestion' } } },
        { type: 'stream_event', session_id: 's3', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } } },
        { type: 'stream_event', session_id: 's3', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's3' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)

      // No tool_start chunk should mention AskUserQuestion
      const askStarts = streamingMockExports.sendChunk.mock.calls.filter((c) => c[0] === 'tool_start' && c[1] === 'AskUserQuestion')
      expect(askStarts).toHaveLength(0)
      // No tool_input chunk for AskUserQuestion either
      const askInputs = streamingMockExports.sendChunk.mock.calls.filter(
        (c) => c[0] === 'tool_input' && (c[2] as Record<string, unknown>)?.toolId === 'ask_1',
      )
      expect(askInputs).toHaveLength(0)
      // toolCallsMap should NOT have ask_1 because AskUserQuestion is special-cased
      expect(result.toolCalls.find((t) => t.id === 'ask_1')).toBeUndefined()
    })

    it('input_json_delta: accumulates partial JSON across multiple deltas', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's4' },
        { type: 'stream_event', session_id: 's4', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_2', name: 'Edit' } } },
        { type: 'stream_event', session_id: 's4', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"a":1' } } },
        { type: 'stream_event', session_id: 's4', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: ',"b":2}' } } },
        { type: 'stream_event', session_id: 's4', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's4' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'edit' }], 'sys', baseAiSettings as never, null)
      expect(result.toolCalls[0].input).toBe('{"a":1,"b":2}')
    })

    it('input_json_delta: ignored when no currentToolBlockId (defensive branch)', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's4b' },
        // input_json_delta arrives WITHOUT a preceding tool_use start — should be ignored
        { type: 'stream_event', session_id: 's4b', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"orphan":true}' } } },
        { type: 'stream_event', session_id: 's4b', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's4b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      // Should not crash; no tool calls registered
      expect(result.toolCalls).toHaveLength(0)
      expect(result.content).toBe('ok')
    })

    it('content_block_stop: detects background Task via run_in_background flag', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's5' },
        { type: 'stream_event', session_id: 's5', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_bg', name: 'Task' } } },
        { type: 'stream_event', session_id: 's5', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"run_in_background":true,"description":"bg"}' } } },
        { type: 'stream_event', session_id: 's5', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's5' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))

      // sendTurn will defer because pendingTaskCount > 0 — invalidate to unblock
      const turnPromise = sessionManager.sendTurn(conv, [{ role: 'user', content: 'launch' }], 'sys', baseAiSettings as never, null)
      await new Promise<void>((r) => setTimeout(r, 50))
      sessionManager.invalidateSession(conv)
      const result = await turnPromise
      // Aborted because we invalidated while turn was deferred
      expect(result.aborted).toBe(true)
      // BUT the Task tool input was captured before invalidation
      expect(result.toolCalls.find((t) => t.id === 'tool_bg')?.input).toContain('run_in_background')
    })

    it('content_block_stop: malformed Task input JSON is silently ignored', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's5b' },
        { type: 'stream_event', session_id: 's5b', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_bad', name: 'Task' } } },
        { type: 'stream_event', session_id: 's5b', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{not valid' } } },
        { type: 'stream_event', session_id: 's5b', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's5b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      // Should NOT defer because parse fails → pendingTaskCount stays 0
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'bad' }], 'sys', baseAiSettings as never, null)
      // Turn completed normally (no defer)
      expect(result.aborted).toBe(false)
    })

    it('content_block_stop: foreground Task (no run_in_background) does NOT defer', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's5c' },
        { type: 'stream_event', session_id: 's5c', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_fg', name: 'Task' } } },
        { type: 'stream_event', session_id: 's5c', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"description":"foreground"}' } } },
        { type: 'stream_event', session_id: 's5c', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's5c' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'fg' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
      expect(result.toolCalls[0].input).toContain('foreground')
    })

    it('content_block_stop for AskUserQuestion: just clears currentToolBlockId, no tool_input chunk', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's6' },
        { type: 'stream_event', session_id: 's6', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'ask_2', name: 'AskUserQuestion' } } },
        { type: 'stream_event', session_id: 's6', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } } },
        { type: 'stream_event', session_id: 's6', event: { type: 'content_block_stop' } },
        // After ask block ends, send another tool_use to verify currentToolBlockId reset
        { type: 'stream_event', session_id: 's6', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tool_after', name: 'Read' } } },
        { type: 'stream_event', session_id: 's6', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's6' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      // Read tool registered, AskUserQuestion not
      expect(result.toolCalls.map((t) => t.id)).toEqual(['tool_after'])
    })

    it('content_block_stop: no-op when no currentToolBlockId set', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's6b' },
        // Stop without prior start — should be silently ignored
        { type: 'stream_event', session_id: 's6b', event: { type: 'content_block_stop' } },
        { type: 'stream_event', session_id: 's6b', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's6b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      expect(result.content).toBe('after')
      expect(result.toolCalls).toHaveLength(0)
    })

    it('unknown event type is silently ignored', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 's7' },
        // unknown event types should not crash the handler
        { type: 'stream_event', session_id: 's7', event: { type: 'message_start' } },
        { type: 'stream_event', session_id: 's7', event: { type: 'message_stop' } },
        { type: 'stream_event', session_id: 's7', event: { type: 'ping' } },
        { type: 'stream_event', session_id: 's7', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', text: 'thinking...' } } },
        { type: 'stream_event', session_id: 's7', event: { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'sig' } } },
        { type: 'stream_event', session_id: 's7', event: {} }, // empty event
        { type: 'stream_event', session_id: 's7' }, // event missing entirely
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 's7' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
      expect(result.content).toBe('')
    })
  })

  // ─── handleResultMessage branches ──────────────────────────

  describe('handleResultMessage', () => {
    it('captures stop_reason, subtype, and usage on success', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r1' },
        { type: 'stream_event', session_id: 'r1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } },
        {
          type: 'result',
          subtype: 'success',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
          session_id: 'r1',
        },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'go' }], 'sys', baseAiSettings as never, null)

      expect(result.stopReason).toBe('end_turn')
      expect(result.usage?.input_tokens).toBe(10)
      expect(result.usage?.output_tokens).toBe(20)
      expect(result.usage?.cache_read_input_tokens).toBe(5)
    })

    it('captures context_window from modelUsage', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r2' },
        { type: 'stream_event', session_id: 'r2', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'k' } } },
        {
          type: 'result',
          subtype: 'success',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1 },
          modelUsage: {
            'claude-sonnet-4': { contextWindow: 200_000 },
            'claude-haiku': { contextWindow: 100_000 },
          },
          session_id: 'r2',
        },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'go' }], 'sys', baseAiSettings as never, null)
      // Picks max of modelUsage entries
      expect(result.usage?.context_window).toBe(200_000)
    })

    it('modelUsage with no contextWindow values does not override', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r2b' },
        { type: 'stream_event', session_id: 'r2b', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'k' } } },
        {
          type: 'result',
          subtype: 'success',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1 },
          modelUsage: { 'no-window': {} },
          session_id: 'r2b',
        },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'go' }], 'sys', baseAiSettings as never, null)
      expect(result.usage?.context_window).toBeUndefined()
    })

    it('tool_result subtype with tool_name: emits tool_result chunk and updates toolCallsMap', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r3' },
        { type: 'stream_event', session_id: 'r3', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' } } },
        { type: 'stream_event', session_id: 'r3', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":"x"}' } } },
        { type: 'stream_event', session_id: 'r3', event: { type: 'content_block_stop' } },
        {
          type: 'result',
          subtype: 'tool_result',
          tool_name: 'Read',
          tool_use_id: 'tu_1',
          summary: 'short',
          content: 'long content here',
          session_id: 'r3',
        },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r3' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'read' }], 'sys', baseAiSettings as never, null)

      const toolResultCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'tool_result')
      expect(toolResultCall).toBeDefined()
      expect(toolResultCall?.[1]).toBe('short')
      const extra = toolResultCall?.[2] as Record<string, unknown>
      expect(extra.toolName).toBe('Read')
      expect(extra.toolId).toBe('tu_1')
      expect(extra.toolOutput).toBe('long content here')

      const tc = result.toolCalls.find((t) => t.id === 'tu_1')
      expect(tc?.output).toBe('long content here')
      expect(tc?.status).toBe('done')
    })

    it('tool_result: tool_name fallback when only tool_use_id present', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r3b' },
        // tool_result branch entered via subtype, no tool_name → fallback 'tool'
        { type: 'result', subtype: 'tool_result', tool_use_id: 'orphan_1', content: 'output', session_id: 'r3b' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r3b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      const tc = result.toolCalls.find((t) => t.id === 'orphan_1')
      expect(tc?.name).toBe('tool')
      expect(tc?.output).toBe('output')
    })

    it('tool_result: missing tool_use_id falls back to synthetic id', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r3c' },
        { type: 'result', tool_name: 'X', summary: 's', content: 'out', session_id: 'r3c' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r3c' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)
      const tc = result.toolCalls.find((t) => t.name === 'X')
      expect(tc).toBeDefined()
      expect((tc!.id as string).startsWith('tool_')).toBe(true)
    })

    it('tool_result: AskUserQuestion id is silently consumed (not emitted as tool_result)', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r4' },
        { type: 'stream_event', session_id: 'r4', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'ask_3', name: 'AskUserQuestion' } } },
        { type: 'stream_event', session_id: 'r4', event: { type: 'content_block_stop' } },
        // tool_result for ask_3 — should NOT emit chunk, only consume from askUserToolIds
        { type: 'result', subtype: 'tool_result', tool_name: 'AskUserQuestion', tool_use_id: 'ask_3', summary: 's', session_id: 'r4' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r4' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: '?' }], 'sys', baseAiSettings as never, null)

      const askResultCall = streamingMockExports.sendChunk.mock.calls.find(
        (c) => c[0] === 'tool_result' && (c[2] as Record<string, unknown>)?.toolId === 'ask_3',
      )
      expect(askResultCall).toBeUndefined()
    })

    it('tool_result: output is capped to 50_000 chars', async () => {
      const conv = allocConv()
      const huge = 'x'.repeat(60_000)
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r5' },
        { type: 'stream_event', session_id: 'r5', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_huge', name: 'Read' } } },
        { type: 'stream_event', session_id: 'r5', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'tool_result', tool_name: 'Read', tool_use_id: 'tu_huge', content: huge, session_id: 'r5' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r5' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'big' }], 'sys', baseAiSettings as never, null)
      const tc = result.toolCalls.find((t) => t.id === 'tu_huge')
      expect(tc?.output.length).toBe(50_000)
    })

    it('tool_result with summary only (no content): uses summary as fullOutput', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r5b' },
        { type: 'stream_event', session_id: 'r5b', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_sum', name: 'X' } } },
        { type: 'stream_event', session_id: 'r5b', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'tool_result', tool_name: 'X', tool_use_id: 'tu_sum', summary: 'only summary', session_id: 'r5b' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r5b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const tc = result.toolCalls.find((t) => t.id === 'tu_sum')
      expect(tc?.output).toBe('only summary')
    })

    it('error_during_execution subtype ends turn with done', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r6' },
        { type: 'stream_event', session_id: 'r6', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } } },
        { type: 'result', subtype: 'error_during_execution', stop_reason: 'tool_error', session_id: 'r6' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.content).toBe('partial')
      expect(result.stopReason).toBe('tool_error')
      const doneCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'done')
      expect(doneCall).toBeDefined()
      const extra = doneCall?.[2] as Record<string, unknown>
      expect(extra.resultSubtype).toBe('error_during_execution')
    })

    it('error_max_turns subtype ends turn', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r7' },
        { type: 'result', subtype: 'error_max_turns', stop_reason: 'max_turns', session_id: 'r7' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.stopReason).toBe('max_turns')
    })

    it('error_max_budget_usd subtype ends turn', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r7b' },
        { type: 'result', subtype: 'error_max_budget_usd', stop_reason: 'budget', session_id: 'r7b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.stopReason).toBe('budget')
    })

    it('non-terminal subtype does NOT end turn (e.g. stripped subtype)', async () => {
      const conv = allocConv()
      let resolved = false
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r8' },
        // subtype not in TURN_END_SUBTYPES — captured but no done emitted
        { type: 'result', subtype: 'unknown_intermediate', session_id: 'r8' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const turnPromise = sessionManager
        .sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
        .then((r) => {
          resolved = true
          return r
        })
      await new Promise<void>((r) => setTimeout(r, 50))
      expect(resolved).toBe(false)
      sessionManager.invalidateSession(conv)
      const result = await turnPromise
      expect(result.aborted).toBe(true)
    })

    it('result with no subtype is captured but does not end turn', async () => {
      const conv = allocConv()
      let resolved = false
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r8b' },
        { type: 'result', usage: { input_tokens: 5 }, session_id: 'r8b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const turnPromise = sessionManager
        .sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
        .then((r) => {
          resolved = true
          return r
        })
      await new Promise<void>((r) => setTimeout(r, 50))
      expect(resolved).toBe(false)
      sessionManager.invalidateSession(conv)
      await turnPromise
    })

    it('done chunk includes stopReason + resultSubtype extras', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'r9' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'r9' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const doneCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'done')
      const extra = doneCall?.[2] as Record<string, unknown>
      expect(extra.stopReason).toBe('end_turn')
      expect(extra.resultSubtype).toBe('success')
      expect(extra.conversationId).toBe(conv)
    })
  })

  // ─── handleSystemMessage branches ──────────────────────────

  describe('handleSystemMessage', () => {
    it('init with mcp_servers: emits mcp_status chunk', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        {
          type: 'system',
          subtype: 'init',
          mcp_servers: [
            { name: 'good', status: 'connected' },
            { name: 'bad', status: 'failed', error: 'oops' },
          ],
          session_id: 'sm1',
        },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm1' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)

      const mcpCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'mcp_status')
      expect(mcpCall).toBeDefined()
      const extra = mcpCall?.[2] as Record<string, unknown>
      const parsed = JSON.parse(extra.mcpServers as string)
      expect(parsed).toHaveLength(2)
    })

    it('init without mcp_servers field: no mcp_status chunk emitted', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        // init but mcp_servers omitted — handler returns early
        { type: 'system', subtype: 'init', session_id: 'sm1b' },
        { type: 'stream_event', session_id: 'sm1b', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'k' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm1b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const mcpCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'mcp_status')
      expect(mcpCall).toBeUndefined()
    })

    it('hook_response with valid JSON output: emits system_message chunk', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm2' },
        {
          type: 'system',
          subtype: 'hook_response',
          hook_name: 'pre-bash',
          hook_event: 'PreToolUse',
          output: JSON.stringify({ systemMessage: 'hook says hi' }),
          session_id: 'sm2',
        },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm2' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const sysMsgCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'system_message')
      expect(sysMsgCall).toBeDefined()
      expect(sysMsgCall?.[1]).toBe('hook says hi')
      const extra = sysMsgCall?.[2] as Record<string, unknown>
      expect(extra.hookName).toBe('pre-bash')
      expect(extra.hookEvent).toBe('PreToolUse')
    })

    it('hook_response with non-JSON output: silently ignored', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm3' },
        { type: 'system', subtype: 'hook_response', output: 'not json {{', session_id: 'sm3' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm3' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const sysMsgCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'system_message')
      expect(sysMsgCall).toBeUndefined()
    })

    it('hook_response with empty output: silently ignored', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm3b' },
        { type: 'system', subtype: 'hook_response', output: '', stdout: '', session_id: 'sm3b' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm3b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const sysMsgCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'system_message')
      expect(sysMsgCall).toBeUndefined()
    })

    it('hook_response with JSON but no systemMessage field: no chunk', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm3c' },
        { type: 'system', subtype: 'hook_response', output: JSON.stringify({ otherField: 'x' }), session_id: 'sm3c' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm3c' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const sysMsgCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'system_message')
      expect(sysMsgCall).toBeUndefined()
    })

    it('task_started without task_id: no-op', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm4' },
        { type: 'system', subtype: 'task_started', session_id: 'sm4' }, // no task_id
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm4' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
    })

    it('task_progress without task_id: no-op', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm5' },
        { type: 'system', subtype: 'task_progress', session_id: 'sm5' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm5' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
    })

    it('task_started/task_progress with task_id: logged but no chunk emitted', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm6' },
        { type: 'system', subtype: 'task_started', task_id: 't1', description: 'go', session_id: 'sm6' },
        { type: 'system', subtype: 'task_progress', task_id: 't1', last_tool_name: 'Read', session_id: 'sm6' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm6' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const taskStartedChunk = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'task_started')
      const taskProgressChunk = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'task_progress')
      expect(taskStartedChunk).toBeUndefined()
      expect(taskProgressChunk).toBeUndefined()
    })

    it('task_progress without last_tool_name: still logs (no crash)', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm6b' },
        { type: 'system', subtype: 'task_progress', task_id: 't2', session_id: 'sm6b' }, // no last_tool_name
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm6b' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
    })

    it('task_started without description: still logs (no crash)', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm6c' },
        { type: 'system', subtype: 'task_started', task_id: 't3', session_id: 'sm6c' }, // no description
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm6c' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
    })

    it('task_notification without preceding pendingTaskCount: still emits chunk, count stays 0', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm7' },
        {
          type: 'system',
          subtype: 'task_notification',
          task_id: 't_orphan',
          status: 'completed',
          summary: 'orphan done',
          output_file: '/tmp/x.txt',
          session_id: 'sm7',
        },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm7' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      const notifCall = streamingMockExports.sendChunk.mock.calls.find((c) => c[0] === 'task_notification')
      expect(notifCall).toBeDefined()
      expect(notifCall?.[1]).toBe('orphan done')
      const extra = notifCall?.[2] as Record<string, unknown>
      expect(extra.taskId).toBe('t_orphan')
      expect(extra.taskStatus).toBe('completed')
      expect(extra.outputFile).toBe('/tmp/x.txt')
    })

    it('unknown subtype: silently dropped', async () => {
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm8' },
        { type: 'system', subtype: 'unknown_subtype', session_id: 'sm8' },
        { type: 'system', session_id: 'sm8' }, // no subtype at all
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm8' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
    })

    it('between-turn task_notification: forwarded; init/hook_response between turns dropped', async () => {
      // This drives handleBetweenTurnMessage's filter — which is the within-turn
      // counterpart for handleSystemMessage's subtype switch. Confirms only
      // task_notification escapes the between-turn filter.
      const conv = allocConv()
      const messages: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'sm9' },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'sm9' },
        // After currentTurn = null:
        { type: 'system', subtype: 'init', mcp_servers: [{ name: 'after', status: 'connected' }], session_id: 'sm9' },
        { type: 'system', subtype: 'hook_response', output: JSON.stringify({ systemMessage: 'late' }), session_id: 'sm9' },
        { type: 'system', subtype: 'task_notification', task_id: 'late', status: 'completed', summary: 'late done', session_id: 'sm9' },
      ]
      mockSdk.query.mockReturnValue(makeQuery(messages))
      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
      expect(result.aborted).toBe(false)
      // Wait for between-turn messages to be processed
      await new Promise<void>((r) => setTimeout(r, 50))

      const calls = streamingMockExports.sendChunk.mock.calls
      const doneIdx = calls.findIndex((c) => c[0] === 'done')

      // No second mcp_status emitted post-done
      const lateMcp = calls.findIndex(
        (c, i) => i > doneIdx && c[0] === 'mcp_status',
      )
      expect(lateMcp).toBe(-1)

      // No system_message emitted post-done
      const lateSysMsg = calls.findIndex(
        (c, i) => i > doneIdx && c[0] === 'system_message',
      )
      expect(lateSysMsg).toBe(-1)

      // task_notification IS emitted post-done
      const lateNotif = calls.findIndex(
        (c, i) => i > doneIdx && c[0] === 'task_notification' && (c[2] as Record<string, unknown>)?.taskId === 'late',
      )
      expect(lateNotif).toBeGreaterThan(-1)
    })
  })

  // ─── Cross-handler integration: deferred turn end → poll → fini → done ──

  describe('handleResultMessage deferred branch (full flow)', () => {
    it('deferred turn-end completes when poll response is "fini"', async () => {
      vi.useFakeTimers()
      const conv = allocConv()

      // Phase 1: launch background Task → defer turn end (poll starts)
      const phase1: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'def1' },
        { type: 'stream_event', session_id: 'def1', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'bg', name: 'Task' } } },
        { type: 'stream_event', session_id: 'def1', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"run_in_background":true}' } } },
        { type: 'stream_event', session_id: 'def1', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def1' }, // deferred
      ]

      // Phase 2: poll fires → user prompt added → assistant replies "fini" → result/success
      const phase2: SDKMessage[] = [
        { type: 'stream_event', session_id: 'def1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fini' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def1' },
      ]

      let phase1Idx = 0
      let phase2Idx = 0
      let phase1Done = false
      const mockQuery = {
        [Symbol.asyncIterator]: () => ({
          async next() {
            if (phase1Idx < phase1.length) return { value: phase1[phase1Idx++], done: false }
            if (!phase1Done) {
              phase1Done = true
              // After phase1, block until poll prompts content
              await new Promise<void>((r) => setTimeout(r, 0))
            }
            if (phase2Idx < phase2.length) return { value: phase2[phase2Idx++], done: false }
            return new Promise<{ value: undefined; done: true }>(() => {})
          },
        }),
        close: vi.fn(),
      }
      mockSdk.query.mockReturnValue(mockQuery)

      const turnPromise = sessionManager.sendTurn(conv, [{ role: 'user', content: 'launch' }], 'sys', baseAiSettings as never, null)
      // Run microtasks + advance fake timers to fire 30s poll
      await vi.advanceTimersByTimeAsync(31_000)
      vi.useRealTimers()
      // Allow phase2 messages to be consumed
      await new Promise<void>((r) => setTimeout(r, 50))

      const result = await turnPromise
      // Content must include the "fini" reply (proving poll response branch ran)
      expect(result.content).toContain('fini')
      expect(result.aborted).toBe(false)
      sessionManager.invalidateSession(conv)
    }, 10_000)

    it('deferred turn-end with non-fini poll response: stays open until invalidate', async () => {
      vi.useFakeTimers()
      const conv = allocConv()

      const phase1: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'def2' },
        { type: 'stream_event', session_id: 'def2', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'bg2', name: 'Task' } } },
        { type: 'stream_event', session_id: 'def2', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"run_in_background":true}' } } },
        { type: 'stream_event', session_id: 'def2', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def2' },
      ]
      const phase2: SDKMessage[] = [
        { type: 'stream_event', session_id: 'def2', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'still running' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def2' },
      ]

      let p1 = 0
      let p2 = 0
      const mockQuery = {
        [Symbol.asyncIterator]: () => ({
          async next() {
            if (p1 < phase1.length) return { value: phase1[p1++], done: false }
            if (p2 < phase2.length) return { value: phase2[p2++], done: false }
            return new Promise<{ value: undefined; done: true }>(() => {})
          },
        }),
        close: vi.fn(),
      }
      mockSdk.query.mockReturnValue(mockQuery)

      const turnPromise = sessionManager.sendTurn(conv, [{ role: 'user', content: 'launch' }], 'sys', baseAiSettings as never, null)
      await vi.advanceTimersByTimeAsync(31_000)
      vi.useRealTimers()
      await new Promise<void>((r) => setTimeout(r, 50))

      // Turn should still be in progress — invalidate
      sessionManager.invalidateSession(conv)
      const result = await turnPromise
      expect(result.aborted).toBe(true)
    }, 10_000)

    it('task_notification while deferred: decrements pendingTaskCount and pushes aggregation prompt', async () => {
      const conv = allocConv()

      // Launch background → defer → task_notification clears pendingTaskCount → aggregation prompt → final done
      const phase1: SDKMessage[] = [
        { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'def3' },
        { type: 'stream_event', session_id: 'def3', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'bg3', name: 'Task' } } },
        { type: 'stream_event', session_id: 'def3', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"run_in_background":true}' } } },
        { type: 'stream_event', session_id: 'def3', event: { type: 'content_block_stop' } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def3' }, // deferred
      ]
      const phase2: SDKMessage[] = [
        { type: 'system', subtype: 'task_notification', task_id: 'tn', status: 'completed', summary: 'done', session_id: 'def3' },
        { type: 'stream_event', session_id: 'def3', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'aggregated' } } },
        { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'def3' },
      ]

      let p1 = 0
      let p2 = 0
      let phase1Done = false
      const mockQuery = {
        [Symbol.asyncIterator]: () => ({
          async next() {
            if (p1 < phase1.length) return { value: phase1[p1++], done: false }
            if (!phase1Done) {
              phase1Done = true
              await new Promise<void>((r) => setTimeout(r, 30))
            }
            if (p2 < phase2.length) return { value: phase2[p2++], done: false }
            return new Promise<{ value: undefined; done: true }>(() => {})
          },
        }),
        close: vi.fn(),
      }
      mockSdk.query.mockReturnValue(mockQuery)

      const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'go' }], 'sys', baseAiSettings as never, null)
      expect(result.content).toContain('aggregated')
      expect(result.aborted).toBe(false)

      // task_notification chunk should have been emitted before done
      const calls = streamingMockExports.sendChunk.mock.calls
      const notifIdx = calls.findIndex((c) => c[0] === 'task_notification')
      const doneIdx = calls.findIndex((c) => c[0] === 'done')
      expect(notifIdx).toBeGreaterThan(-1)
      expect(doneIdx).toBeGreaterThan(notifIdx)

      sessionManager.invalidateSession(conv)
    }, 10_000)
  })

  // ─── Misc additional coverage ──────────────────────────────

  it('session_id captured from any message (not just first)', async () => {
    const conv = allocConv()
    const messages: SDKMessage[] = [
      // First message has no session_id at all
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } },
      // Second one provides it
      { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'late' },
      { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'late' },
    ]
    mockSdk.query.mockReturnValue(makeQuery(messages))
    const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
    expect(result.sessionId).toBe('late')
  })

  it('iterable ends after result+sessionId: reconnects with resume', async () => {
    const conv = allocConv()
    // First call: yields init+result then ENDS naturally → triggers reconnect path
    let callCount = 0
    mockSdk.query.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        const msgs: SDKMessage[] = [
          { type: 'system', subtype: 'init', mcp_servers: [], session_id: 'reconn-1' },
          { type: 'stream_event', session_id: 'reconn-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } },
          { type: 'result', subtype: 'success', stop_reason: 'end_turn', session_id: 'reconn-1' },
        ]
        return makeQueryThatEnds(msgs)
      }
      // Reconnect: block forever
      return makeQuery([])
    })

    const result = await sessionManager.sendTurn(conv, [{ role: 'user', content: 'x' }], 'sys', baseAiSettings as never, null)
    expect(result.content).toBe('hi')
    // Wait for reconnect
    await new Promise<void>((r) => setTimeout(r, 50))
    expect(callCount).toBe(2)
    // The reconnect call must use resume option
    const reconnectArgs = mockSdk.query.mock.calls[1][0] as { options: { resume?: string } }
    expect(reconnectArgs.options.resume).toBe('reconn-1')
    sessionManager.invalidateSession(conv)
  })
})
