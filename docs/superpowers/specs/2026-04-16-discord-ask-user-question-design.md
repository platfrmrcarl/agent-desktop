# Discord AskUserQuestion — Design Spec

**Date:** 2026-04-16
**Status:** Draft

## Problem

When Claude uses `AskUserQuestion` during streaming, the `canUseTool` callback in `streaming.ts:357-387` blocks on a Promise waiting for user input via `respondToApproval`. The `ask_user` chunk is emitted via `sendChunk()`, but Discord never receives it because:

1. Discord calls `dispatch.get('messages:send')` synchronously — it only gets the final return value
2. `sendChunk()` dispatches via `_chunkSender` (Electron IPC, null in headless) and `broadcast()` utility (handler never set in headless)
3. The stream deadlocks: waiting for a response that can never arrive

**Secondary issue:** The `broadcast()` utility in `core/utils/broadcast.ts` is never wired in headless mode. Stream chunks (text, tool events, ask_user, done) don't reach WebSocket clients either — only the final `messages:send` response does.

## Solution Overview

Two changes:

1. **Multi-handler broadcast utility** — `core/utils/broadcast.ts` supports N handlers instead of 1. Headless wires WS broadcast as a handler, fixing stream chunks for all headless consumers.
2. **Discord `ask_user` handler** — Discord subscribes to broadcast events, intercepts `ask_user` chunks for its bound conversations, presents interactive Discord components, collects responses, and calls `respondToApproval`.

## Detailed Design

### 1. Multi-handler broadcast utility

**File:** `src/core/utils/broadcast.ts`

Current single-handler API becomes multi-handler:

```typescript
type BroadcastFn = (channel: string, ...args: unknown[]) => void

const handlers = new Set<BroadcastFn>()

/** Add a broadcast handler. Returns unsubscribe function. */
export function addBroadcastHandler(fn: BroadcastFn): () => void {
  handlers.add(fn)
  return () => { handlers.delete(fn) }
}

/** Backward-compat: clear all + add one handler. */
export function setBroadcastHandler(fn: BroadcastFn): void {
  handlers.clear()
  handlers.add(fn)
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const fn of handlers) fn(channel, ...args)
}
```

**Wiring in headless** (`src/headless/index.ts`):

After `startServer()`, register WS broadcaster:

```typescript
import { addBroadcastHandler } from '../core/utils/broadcast'

if (flags.server) {
  // ... existing startServer code ...
  wsBroadcast = getWsBroadcaster() ?? null

  // Wire stream chunks to WS clients
  addBroadcastHandler((channel, ...args) => {
    wsBroadcast?.(channel, ...args)
  })
}
```

This fixes stream chunks for web clients as a side effect.

### 2. Discord `ask_user` handler

**File:** `src/core/services/discord.ts`

#### 2.1 Broadcast subscription

In `startBot()`, after Discord client is ready, register a broadcast handler:

```typescript
import { addBroadcastHandler } from '../utils/broadcast'

// In startBot():
const unsubscribe = addBroadcastHandler((channel, ...args) => {
  if (channel !== 'messages:stream') return
  const payload = args[0] as Record<string, unknown>
  if (payload?.type !== 'ask_user') return
  handleAskUserChunk(payload)
})

// Store unsubscribe for stopBot()
```

#### 2.2 Chunk routing

```typescript
function handleAskUserChunk(payload: Record<string, unknown>): void {
  const conversationId = payload.conversationId as number | undefined
  if (!conversationId) return

  // Find the Discord channel bound to this conversation
  let targetChannelId: string | null = null
  for (const [channelId, convId] of channelConversations) {
    if (convId === conversationId) {
      targetChannelId = channelId
      break
    }
  }
  if (!targetChannelId) return // Not a Discord-bound conversation

  const requestId = payload.requestId as string
  const questions: AskUserQuestion[] = JSON.parse(payload.questions as string)
  presentAskUser(targetChannelId, requestId, questions)
}
```

#### 2.3 Discord interactive components

`presentAskUser(channelId, requestId, questions)`:

1. **Build Embed:**
   - Title: first question header or "Question"
   - Description: formatted questions with numbered list
   - Each question shows its options as bullet points

2. **Build ActionRows** (max 5 per message):
   - One `StringSelectMenu` per question that has options:
     - `customId`: `askuser_${requestId}_q${index}`
     - Options from `AskUserQuestion.options` mapped to `{ label, description, value: label }`
     - Extra option: `{ label: 'Autre...', description: 'Saisir une r\u00e9ponse libre', value: '__other__' }`
     - `setMinValues(1)`, `setMaxValues(multiSelect ? options.length + 1 : 1)`
   - One `Button` "Repondre en texte libre":
     - `customId`: `askuser_modal_${requestId}`
     - Style: Secondary

3. **Send message** to channel with embed + components

4. **Create interaction collector** on the message:
   - `filter`: only interactions from allowed users
   - `time`: 300_000 ms (5 minutes)
   - Track answered questions in a `Map<number, string>` (question index -> answer)

#### 2.4 Interaction handling

**StringSelectMenu interaction:**
- Parse question index from `customId`
- If selected value is `__other__` → show modal for that question
- Otherwise → record answer(s), update collector state
- When all questions answered → submit

**Button interaction (modal trigger):**
- Build `ModalBuilder` with `customId`: `askuser_submit_${requestId}`
- One `TextInputBuilder` per question:
  - `customId`: `q${index}`
  - `label`: question header (truncated to 45 chars for Discord limit)
  - `style`: `TextInputStyle.Short` or `Paragraph` depending on question
  - `placeholder`: first option label or empty
- Show modal via `interaction.showModal(modal)`

**ModalSubmit interaction:**
- Extract answers from `fields.getTextInputValue('q0')`, `q1`, etc.
- Record all answers → submit

**Submit:**
- Build answers object: `{ "0": "selected answer", "1": "other answer", ... }`
- Call `botDispatch!.get('messages:respondToApproval')!(requestId, { answers })`
- Edit original message to show submitted answers (remove components)
- Stop collector

#### 2.5 Timeout handling

When collector ends with reason `'time'`:
- Edit message: remove components, add "(Timeout - pas de reponse)"
- Call `botDispatch!.get('messages:respondToApproval')!(requestId, { answers: {} })` with empty answers to unblock stream

#### 2.6 Cleanup on `stopBot()`

Call stored `unsubscribe()` function to remove broadcast handler.

### 3. New Discord.js imports

Add to existing imports in `discord.ts`:

```typescript
import {
  // existing...
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ComponentType,
} from 'discord.js'
```

### 4. Type imports

```typescript
import type { AskUserQuestion, AskUserResponse } from '../types'
```

### 5. Files modified

| File | Change |
|------|--------|
| `src/core/utils/broadcast.ts` | Add `addBroadcastHandler`, make `broadcast()` fan-out to Set |
| `src/headless/index.ts` | Wire WS broadcast via `addBroadcastHandler` |
| `src/core/services/discord.ts` | Add `ask_user` handler with Discord interactive components |
| `src/main/utils/broadcast.ts` | Re-export `addBroadcastHandler` |

### 6. Files NOT modified

- `streaming.ts` — `sendChunk()` already calls `broadcast()`, just needs handler wired
- `Broadcaster` interface — no change needed
- `messages.ts` handlers — `respondToApproval` dispatch already registered
- Web server — gets stream chunks for free via the broadcast handler fix

## Edge Cases

1. **Multiple questions (1-4):** All fit in one message (4 selects + 1 button = 5 action rows = Discord max)
2. **Questions with no options:** Skip select menu, only text input via modal
3. **User leaves Discord during stream:** 5-min timeout resolves with empty answers
4. **Two concurrent ask_user on same channel:** Each has unique `requestId`, collectors are independent
5. **ask_user for non-Discord conversation:** Filtered out by `channelConversations` lookup
6. **Bot not in channel:** `client.channels.fetch()` may fail — catch and log error

## Verification

1. **Unit tests:** Mock Discord client interactions, verify `respondToApproval` called with correct answers
2. **Integration test:** Send message to Discord bot that triggers AskUserQuestion → verify interactive components appear → simulate response → verify stream continues
3. **Manual test:** Run headless with `--discord`, send a message that triggers Claude's AskUserQuestion, answer via Discord select menu, verify response completes
4. **Regression:** Verify Electron mode unaffected (`setBroadcastHandler` compat preserved)
5. **Web server fix:** Verify WS clients now receive stream chunks in headless mode
