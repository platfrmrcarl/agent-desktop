# Scheduled Task — Pre-Run Context Action — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each scheduled task declare how its conversation is prepared before each run — keep, clear, or compact — so long-running recurring tasks don't overflow context.

**Architecture:** Additive DB column + small UI radio group + orchestration block in `executeTask`. Reuses existing `cleared_at` soft-clear and the existing (private) `compactConversation()` summarizer. Per-entry-point wiring (Electron main + headless) through `TaskRunContext`.

**Tech Stack:** TypeScript, Electron, React, better-sqlite3 (main) / sql.js (headless), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-18-scheduled-task-pre-run-action-design.md`

---

## File Structure

**Modified:**
- `src/core/types/types.ts` — add `PreRunAction` type, extend `ScheduledTask` / `CreateScheduledTask`.
- `src/core/db/schema.ts` — add column to CREATE TABLE + migration block.
- `src/core/services/scheduler.ts` — CRUD (`rowToTask`, `create`, `update`) + validation.
- `src/core/services/taskExecutor.ts` — extend `TaskRunContext`; insert orchestration block in `executeTask`.
- `src/core/services/taskExecutor.test.ts` — extend `makeTask` helper + new cases.
- `src/core/services/scheduler.test.ts` — new CRUD cases.
- `src/core/handlers/messages.ts` — `export` on `compactConversation`.
- `src/main/services/messages.ts` — `export` on `compactConversation`.
- `src/main/services/scheduler.ts` — wire `clearConversation` + `compactConversation` into `createElectronContext`.
- `src/headless/taskRunner.ts` — wire both methods into `createCoreContext`.
- `src/renderer/components/scheduler/TaskFormModal.tsx` — radio group + state + submit.

**No new files.**

---

## Phase 1 — Data model + types

### Task 1.1: Add `PreRunAction` type and extend task interfaces

**Files:**
- Modify: `src/core/types/types.ts:178-215`

- [ ] **Step 1: Add the type and extend both interfaces**

Edit `src/core/types/types.ts`. Replace the block from line 178 to line 215 with:

```ts
export type IntervalUnit = 'minutes' | 'hours' | 'days'
export type TaskStatus = 'success' | 'error' | 'running'
export type PreRunAction = 'none' | 'clear' | 'compact'

export interface ScheduledTask {
  id: number
  name: string
  prompt: string
  conversation_id: number
  conversation_title?: string
  enabled: boolean
  interval_value: number
  interval_unit: IntervalUnit
  schedule_time: string | null
  catch_up: boolean
  max_runs: number | null
  last_run_at: string | null
  next_run_at: string | null
  last_status: TaskStatus | null
  last_error: string | null
  run_count: number
  notify_desktop: boolean
  notify_voice: boolean
  pre_run_action: PreRunAction
  created_at: string
  updated_at: string
}

export interface CreateScheduledTask {
  name: string
  prompt: string
  conversation_id?: number          // omit to auto-create a new conversation
  interval_value: number
  interval_unit: IntervalUnit
  schedule_time?: string
  catch_up?: boolean
  max_runs?: number | null
  notify_desktop?: boolean
  notify_voice?: boolean
  pre_run_action?: PreRunAction
}
```

- [ ] **Step 2: Type-check the tree**

Run: `npx tsc --noEmit`
Expected: Many errors (existing code doesn't set `pre_run_action` yet — will be fixed in later tasks). Record the error count and move on; it should drop as we go.

- [ ] **Step 3: Commit**

```bash
git add src/core/types/types.ts
git commit -m "types: add PreRunAction and pre_run_action field on ScheduledTask"
```

---

### Task 1.2: Schema — add column to CREATE TABLE and migration

**Files:**
- Modify: `src/core/db/schema.ts:96-118` (CREATE TABLE)
- Modify: `src/core/db/schema.ts:203-216` (migration block)

- [ ] **Step 1: Add column to the CREATE TABLE statement**

In `src/core/db/schema.ts`, inside the `CREATE TABLE IF NOT EXISTS scheduled_tasks (...)` statement (starts at line 96), add a new line right after `notify_voice INTEGER DEFAULT 0,`:

```
    pre_run_action TEXT NOT NULL DEFAULT 'none',
```

Full column block after edit:

```
    notify_voice INTEGER DEFAULT 0,
    pre_run_action TEXT NOT NULL DEFAULT 'none',
    created_at DATETIME DEFAULT (datetime('now')),
```

- [ ] **Step 2: Add migration block**

Immediately after the existing `max_runs` migration block (around line 216), add:

```ts
  // Add pre_run_action column to scheduled_tasks (conversation preparation before each run)
  if (!schedCols.some((c) => c.name === 'pre_run_action')) {
    try {
      db.exec("ALTER TABLE scheduled_tasks ADD COLUMN pre_run_action TEXT NOT NULL DEFAULT 'none'")
    } catch (e) {
      console.warn('[migration] scheduled_tasks.pre_run_action:', e)
    }
  }
```

Note: `schedCols` is already defined above — reuse the same variable.

- [ ] **Step 3: Build to confirm schema compiles**

Run: `npx tsc --noEmit src/core/db/schema.ts` (or full `npx tsc --noEmit`)
Expected: No new errors introduced by this edit (pre-existing errors from Task 1.1 still present).

- [ ] **Step 4: Commit**

```bash
git add src/core/db/schema.ts
git commit -m "db: add pre_run_action column to scheduled_tasks with migration"
```

---

### Task 1.3: Scheduler CRUD — map, insert, update, validate

**Files:**
- Modify: `src/core/services/scheduler.ts:64-87` (`rowToTask`)
- Modify: `src/core/services/scheduler.ts:133-192` (`create`)
- Modify: `src/core/services/scheduler.ts:194-272` (`update`)

- [ ] **Step 1: Add validator helper at the top of the file**

After the imports block (around line 4), add:

```ts
const VALID_PRE_RUN_ACTIONS: readonly PreRunAction[] = ['none', 'clear', 'compact']

function validatePreRunAction(value: unknown): PreRunAction {
  if (typeof value !== 'string' || !VALID_PRE_RUN_ACTIONS.includes(value as PreRunAction)) {
    throw new Error("pre_run_action must be 'none', 'clear', or 'compact'")
  }
  return value as PreRunAction
}
```

Update the import on line 4 to include `PreRunAction`:

```ts
import type { ScheduledTask, CreateScheduledTask, IntervalUnit, PreRunAction } from '../types'
```

- [ ] **Step 2: Update `rowToTask` to map the column**

In `rowToTask` (starts line 64), add inside the returned object after `notify_voice: Boolean(row.notify_voice ?? 0),`:

```ts
    pre_run_action: (row.pre_run_action as PreRunAction) || 'none',
```

Full relevant section after edit:

```ts
    notify_voice: Boolean(row.notify_voice ?? 0),
    pre_run_action: (row.pre_run_action as PreRunAction) || 'none',
    created_at: row.created_at as string,
```

- [ ] **Step 3: Update `create()` to insert the column**

In `create()` (starts line 133), locate the `INSERT INTO scheduled_tasks` statement (line 171). Update it to include `pre_run_action`:

```ts
    const preRunAction: PreRunAction = data.pre_run_action !== undefined
      ? validatePreRunAction(data.pre_run_action)
      : 'none'

    const result = this.db.prepare(`
      INSERT INTO scheduled_tasks (name, prompt, conversation_id, interval_value, interval_unit,
        schedule_time, catch_up, max_runs, notify_desktop, notify_voice, pre_run_action,
        next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name,
      data.prompt,
      conversationId,
      data.interval_value,
      data.interval_unit,
      data.schedule_time || null,
      data.catch_up !== false ? 1 : 0,
      data.max_runs ?? null,
      data.notify_desktop !== false ? 1 : 0,
      data.notify_voice ? 1 : 0,
      preRunAction,
      nextRun,
      nowIso,
      nowIso,
    )
```

Insert the `preRunAction` computation block just before `const result = this.db.prepare(...)`.

- [ ] **Step 4: Update `update()` to handle the column**

In `update()` (starts line 194), after the `notify_voice` block (around line 253), add:

```ts
    if (data.pre_run_action !== undefined) {
      const action = validatePreRunAction(data.pre_run_action)
      updates.push('pre_run_action = ?')
      values.push(action)
    }
```

- [ ] **Step 5: Commit**

```bash
git add src/core/services/scheduler.ts
git commit -m "scheduler: CRUD support for pre_run_action with validation"
```

---

### Task 1.4: Scheduler CRUD tests

**Files:**
- Modify: `src/core/services/scheduler.test.ts`

- [ ] **Step 1: Add a new describe block at the end of the file**

Append to `src/core/services/scheduler.test.ts`:

```ts
describe('SchedulerService — pre_run_action', () => {
  let db: Database.Database
  let service: SchedulerService

  beforeEach(async () => {
    db = await createTestDb()
    service = new SchedulerService(db)
    // Seed a conversation so create() can attach to it
    db.prepare("INSERT INTO conversations (id, title, updated_at) VALUES (1, 'Conv', datetime('now'))").run()
  })

  it("defaults to 'none' when not provided on create", () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    expect(task.pre_run_action).toBe('none')
  })

  it.each(['none', 'clear', 'compact'] as const)("persists '%s' on create", (action) => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
      pre_run_action: action,
    })
    expect(task.pre_run_action).toBe(action)
  })

  it('throws on invalid value at create time', () => {
    expect(() =>
      service.create({
        name: 'T',
        prompt: 'p',
        conversation_id: 1,
        interval_value: 1,
        interval_unit: 'hours',
        // @ts-expect-error — runtime validation test
        pre_run_action: 'garbage',
      }),
    ).toThrow(/pre_run_action/)
  })

  it('updates pre_run_action and readback reflects it', () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    service.update(task.id, { pre_run_action: 'compact' })
    const reloaded = service.get(task.id)
    expect(reloaded?.pre_run_action).toBe('compact')
  })

  it('throws on invalid value at update time', () => {
    const task = service.create({
      name: 'T',
      prompt: 'p',
      conversation_id: 1,
      interval_value: 1,
      interval_unit: 'hours',
    })
    expect(() =>
      // @ts-expect-error — runtime validation test
      service.update(task.id, { pre_run_action: 'nope' }),
    ).toThrow(/pre_run_action/)
  })
})
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/core/services/scheduler.test.ts`
Expected: All new `pre_run_action` tests PASS. Existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/services/scheduler.test.ts
git commit -m "test(scheduler): cover pre_run_action CRUD + validation"
```

---

## Phase 2 — Core orchestration

### Task 2.1: Extend `TaskRunContext` interface

**Files:**
- Modify: `src/core/services/taskExecutor.ts:17-34`

- [ ] **Step 1: Add the two methods to `TaskRunContext`**

In `src/core/services/taskExecutor.ts`, edit the `TaskRunContext` interface. After `onConversationsRefresh(): void` (line 31), add:

```ts
  /** Soft-clear the conversation history before the next run (equivalent to /clear). */
  clearConversation(conversationId: number): void
  /** Summarize and clear the conversation history before the next run (equivalent to /compact). */
  compactConversation(conversationId: number): Promise<void>
```

- [ ] **Step 2: Commit**

```bash
git add src/core/services/taskExecutor.ts
git commit -m "taskExecutor: extend TaskRunContext with clearConversation/compactConversation"
```

---

### Task 2.2: Update the test helpers for the new ctx methods + task field

**Files:**
- Modify: `src/core/services/taskExecutor.test.ts:6-76`

- [ ] **Step 1: Add `pre_run_action` to `makeTask` default**

In `makeTask()` (line 6), add a line before the spread:

```ts
    notify_voice: false,
    pre_run_action: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
```

- [ ] **Step 2: Add the two methods to `createMockCtx`**

In `createMockCtx()` (line 54), update the return type and the returned object:

```ts
function createMockCtx(): {
  buildHistory: ReturnType<typeof vi.fn>
  getAISettings: ReturnType<typeof vi.fn>
  getSystemPrompt: ReturnType<typeof vi.fn>
  streamMessage: ReturnType<typeof vi.fn>
  saveMessage: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onTaskUpdate: ReturnType<typeof vi.fn>
  onConversationsRefresh: ReturnType<typeof vi.fn>
  clearConversation: ReturnType<typeof vi.fn>
  compactConversation: ReturnType<typeof vi.fn>
  db: any
} {
  return {
    buildHistory: vi.fn(() => []),
    getAISettings: vi.fn(() => ({ cwd: '/tmp', mcpServers: { agent_scheduler: { command: 'node', args: [] } } })),
    getSystemPrompt: vi.fn(async () => 'system prompt'),
    streamMessage: vi.fn(async () => makeStreamResult()),
    saveMessage: vi.fn(),
    notify: vi.fn(async () => {}),
    onTaskUpdate: vi.fn(),
    onConversationsRefresh: vi.fn(),
    clearConversation: vi.fn(),
    compactConversation: vi.fn(async () => {}),
    db: {} as any,
  }
}
```

- [ ] **Step 3: Run existing tests to confirm no regression**

Run: `npx vitest run src/core/services/taskExecutor.test.ts`
Expected: All pre-existing tests still PASS. The new `ctx` fields default to no-op mocks, so existing cases keep their behavior.

- [ ] **Step 4: Commit**

```bash
git add src/core/services/taskExecutor.test.ts
git commit -m "test(taskExecutor): extend mocks for pre_run_action plumbing"
```

---

### Task 2.3: TDD — 'clear' branch

**Files:**
- Modify: `src/core/services/taskExecutor.test.ts`
- Modify: `src/core/services/taskExecutor.ts:42-130`

- [ ] **Step 1: Write the failing test**

Append to `describe('executeTask', ...)` in `src/core/services/taskExecutor.test.ts`:

```ts
  describe('pre_run_action', () => {
    it("does NOT call clearConversation or compactConversation when 'none'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'none' }))
      expect(ctx.clearConversation).not.toHaveBeenCalled()
      expect(ctx.compactConversation).not.toHaveBeenCalled()
    })

    it("calls clearConversation BEFORE saveMessage('user') when 'clear'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      const callOrder: string[] = []
      ctx.clearConversation.mockImplementation(() => { callOrder.push('clear') })
      ctx.saveMessage.mockImplementation((_id: number, role: string) => {
        if (role === 'user') callOrder.push('saveUser')
      })

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'clear' }))

      expect(ctx.clearConversation).toHaveBeenCalledWith(10)
      expect(ctx.compactConversation).not.toHaveBeenCalled()
      expect(callOrder.indexOf('clear')).toBeLessThan(callOrder.indexOf('saveUser'))
    })
  })
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `npx vitest run src/core/services/taskExecutor.test.ts -t "pre_run_action"`
Expected: The `'none'` case may PASS (nothing implemented means nothing called), but the `'clear'` case FAILS because `ctx.clearConversation` is never called by the current `executeTask`.

- [ ] **Step 3: Implement the 'clear' branch**

In `src/core/services/taskExecutor.ts`, in `executeTask()`, locate the block after `const aiSettings = ctx.getAISettings(task.conversation_id)` (line 59) and BEFORE the variable-resolver block. Insert:

```ts
    // Pre-run context preparation (keep / clear / compact before this run's prompt is saved)
    if (task.pre_run_action === 'clear') {
      ctx.clearConversation(task.conversation_id)
    } else if (task.pre_run_action === 'compact') {
      try {
        await ctx.compactConversation(task.conversation_id)
      } catch (err) {
        console.warn(
          `[scheduler] Task "${task.name}" (id=${task.id}) compact failed, falling back to clear:`,
          err instanceof Error ? err.message : String(err),
        )
        ctx.clearConversation(task.conversation_id)
      }
    }
```

This block sits between `getAISettings` and `resolveVariablesWithReport`.

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run src/core/services/taskExecutor.test.ts -t "pre_run_action"`
Expected: All three new cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/taskExecutor.ts src/core/services/taskExecutor.test.ts
git commit -m "taskExecutor: run pre_run_action block before saving user prompt"
```

---

### Task 2.4: TDD — 'compact' success branch

**Files:**
- Modify: `src/core/services/taskExecutor.test.ts`

- [ ] **Step 1: Write the failing test**

Inside the `describe('pre_run_action', ...)` added in Task 2.3, append:

```ts
    it("awaits compactConversation BEFORE saveMessage('user') when 'compact'", async () => {
      scheduler.get.mockReturnValue(makeTask())
      const callOrder: string[] = []
      ctx.compactConversation.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5))
        callOrder.push('compact')
      })
      ctx.saveMessage.mockImplementation((_id: number, role: string) => {
        if (role === 'user') callOrder.push('saveUser')
      })

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'compact' }))

      expect(ctx.compactConversation).toHaveBeenCalledWith(10)
      expect(ctx.clearConversation).not.toHaveBeenCalled()
      expect(callOrder.indexOf('compact')).toBeLessThan(callOrder.indexOf('saveUser'))
    })
```

- [ ] **Step 2: Run the test — expect PASS**

Run: `npx vitest run src/core/services/taskExecutor.test.ts -t "pre_run_action"`
Expected: PASS (the implementation in Task 2.3 already covers this branch).

- [ ] **Step 3: Commit**

```bash
git add src/core/services/taskExecutor.test.ts
git commit -m "test(taskExecutor): compact awaited before user message save"
```

---

### Task 2.5: TDD — 'compact' failure → fallback to clear

**Files:**
- Modify: `src/core/services/taskExecutor.test.ts`

- [ ] **Step 1: Write the failing test**

Inside the `describe('pre_run_action', ...)` block, append:

```ts
    it("falls back to clearConversation when compactConversation rejects, and still completes the run", async () => {
      scheduler.get.mockReturnValue(makeTask())
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ctx.compactConversation.mockRejectedValue(new Error('haiku down'))

      await executeTask(scheduler as any, ctx, makeTask({ pre_run_action: 'compact' }))

      expect(ctx.compactConversation).toHaveBeenCalledOnce()
      expect(ctx.clearConversation).toHaveBeenCalledWith(10)
      expect(ctx.streamMessage).toHaveBeenCalledOnce() // run still executed
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
```

- [ ] **Step 2: Run the test — expect PASS**

Run: `npx vitest run src/core/services/taskExecutor.test.ts -t "pre_run_action"`
Expected: PASS (the `try/catch` from Task 2.3 implements this already).

- [ ] **Step 3: Commit**

```bash
git add src/core/services/taskExecutor.test.ts
git commit -m "test(taskExecutor): compact failure falls back to clear, run proceeds"
```

---

## Phase 3 — Entry-point wiring

### Task 3.1: Export `compactConversation` from core handlers

**Files:**
- Modify: `src/core/handlers/messages.ts:764`

- [ ] **Step 1: Change the function declaration**

In `src/core/handlers/messages.ts` line 764, change:

```ts
async function compactConversation(
```

to:

```ts
export async function compactConversation(
```

Nothing else changes — the private dispatch at line 846 (`return compactConversation(db, conversationId)`) keeps working.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: Error count is dropping (some callers in other entry points are being fixed across phases).

- [ ] **Step 3: Commit**

```bash
git add src/core/handlers/messages.ts
git commit -m "messages(core): export compactConversation for reuse in scheduler"
```

---

### Task 3.2: Export `compactConversation` from main messages

**Files:**
- Modify: `src/main/services/messages.ts:735`

- [ ] **Step 1: Change the function declaration**

In `src/main/services/messages.ts` line 735, change:

```ts
async function compactConversation(
```

to:

```ts
export async function compactConversation(
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No new errors added by this edit.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/messages.ts
git commit -m "messages(main): export compactConversation for reuse in scheduler"
```

---

### Task 3.3: Wire both methods into Electron `TaskRunContext`

**Files:**
- Modify: `src/main/services/scheduler.ts:8-9, 40-83`

- [ ] **Step 1: Extend the import from `./messages`**

In `src/main/services/scheduler.ts` line 8, add `compactConversation` to the import:

```ts
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage, compactConversation } from './messages'
```

- [ ] **Step 2: Add the two methods to `createElectronContext`**

In `createElectronContext()` (line 40), inside the returned object, add after `onConversationsRefresh()`:

```ts
    clearConversation(conversationId: number) {
      // Step back 1ms so the user message saved immediately after passes the strict `created_at > cleared_at` filter
      const clearedAt = new Date(Date.now() - 1).toISOString()
      db.prepare(
        'UPDATE conversations SET cleared_at = ?, compact_summary = NULL, sdk_session_id = NULL, updated_at = ? WHERE id = ?'
      ).run(clearedAt, clearedAt, conversationId)
    },
    async compactConversation(conversationId: number) {
      await compactConversation(db, conversationId)
    },
```

Note: there's a name shadow between the imported function and the context method. TypeScript / JS allow this because the method is a property, but to be safe rename the import locally:

Replace the import line with:

```ts
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage, compactConversation as compactConversationImpl } from './messages'
```

And the method becomes:

```ts
    async compactConversation(conversationId: number) {
      await compactConversationImpl(db, conversationId)
    },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: Error count continues to drop.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/scheduler.ts
git commit -m "scheduler(main): wire clear/compact into TaskRunContext"
```

---

### Task 3.4: Wire both methods into headless `TaskRunContext`

**Files:**
- Modify: `src/headless/taskRunner.ts:16, 60-88`

- [ ] **Step 1: Extend the import from core handlers**

In `src/headless/taskRunner.ts` line 16, add the core `compactConversation`:

```ts
import { buildMessageHistory, getAISettings, getSystemPrompt, saveMessage, compactConversation as compactConversationImpl } from '../core/handlers/messages'
```

- [ ] **Step 2: Add the two methods to `createCoreContext`**

`MessagesHandlerOptions` (in `src/core/handlers/messages.ts:18-29`) has three *type-required* fields (`broadcaster`, `hookRunner`, `sessionsBase`) but at runtime `compactConversation` only reads `options.onSessionInvalidate?.(...)`. Headless already has `silentBroadcaster` and `getSessionsBase()` in scope — reuse them so the options value is real and type-clean.

Two small edits needed:

First, add this import near the top (alongside the existing `hookRunner` / `Broadcaster` imports if any; otherwise next to the core imports):

```ts
import type { MessagesHandlerOptions } from '../core/handlers/messages'
```

Then, in `createCoreContext()` (line 60), inside the returned object, append after `onConversationsRefresh()`:

```ts
    clearConversation(conversationId: number) {
      const clearedAt = new Date(Date.now() - 1).toISOString()
      ;(db as any).prepare(
        'UPDATE conversations SET cleared_at = ?, compact_summary = NULL, sdk_session_id = NULL, updated_at = ? WHERE id = ?'
      ).run(clearedAt, clearedAt, conversationId)
    },
    async compactConversation(conversationId: number) {
      const compactOptions: MessagesHandlerOptions = {
        broadcaster: silentBroadcaster,
        hookRunner: { run: async () => ({ decision: 'allow' }) } as any, // not touched by compact
        sessionsBase,
        onSessionInvalidate: () => { /* headless has no live sessions to invalidate */ },
      }
      await compactConversationImpl(db, conversationId, compactOptions)
    },
```

Rationale for the `hookRunner` stub: `compactConversation` does not call `hookRunner` anywhere in its body (verified: it only reads `ai_apiKey` / `ai_baseUrl` settings and calls `options.onSessionInvalidate`). The stub satisfies the type without risking a runtime path.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors. All callers are updated.

- [ ] **Step 4: Build the headless bundle to confirm**

Run: `npm run build:headless`
Expected: Builds successfully.

- [ ] **Step 5: Commit**

```bash
git add src/headless/taskRunner.ts
git commit -m "scheduler(headless): wire clear/compact into TaskRunContext"
```

---

## Phase 4 — UI

### Task 4.1: Add the radio group to `TaskFormModal`

**Files:**
- Modify: `src/renderer/components/scheduler/TaskFormModal.tsx:1, 26-34, 64-76, 358-364`

- [ ] **Step 1: Import the type**

Update the top `import type` line to include `PreRunAction`:

```ts
import type { ScheduledTask, CreateScheduledTask, IntervalUnit, VariableInfo, PreRunAction } from '../../../shared/types'
```

(If the path `../../../shared/types` does not resolve in this file — which it should based on existing imports — mirror the path used by the other type imports in the same line.)

- [ ] **Step 2: Add state**

After the existing `useState` for `notifyVoice` (line 33), add:

```ts
  const [preRunAction, setPreRunAction] = useState<PreRunAction>(task?.pre_run_action ?? 'none')
```

- [ ] **Step 3: Pass it through `onSave`**

In `handleSubmit` (line 56), inside the `onSave(...)` call, add a line after `notify_voice: notifyVoice,`:

```ts
        notify_voice: notifyVoice,
        pre_run_action: preRunAction,
      })
```

- [ ] **Step 4: Render the radio group**

Insert a new section in the form JSX, just BEFORE the `{/* Toggles */}` block (before line 360, where the `<div className="space-y-2">` for toggles starts):

```tsx
          {/* Pre-run context action */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
              Before each run
            </label>
            <div className="flex flex-col gap-1.5">
              {([
                { value: 'none' as const, label: 'Keep context', hint: 'Default — previous history is visible to the AI.' },
                { value: 'clear' as const, label: 'Clear context', hint: 'Resets the conversation history before the prompt. Zero LLM cost.' },
                { value: 'compact' as const, label: 'Compact (summarize, then clear)', hint: 'Summarizes previous history with Haiku, then clears. Falls back to plain clear if the summary fails.' },
              ]).map(({ value, label, hint }) => (
                <label key={value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="preRunAction"
                    checked={preRunAction === value}
                    onChange={() => setPreRunAction(value)}
                    className="accent-[var(--color-primary)] mt-1"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit` and `npm run build`
Expected: Both succeed with 0 errors.

- [ ] **Step 6: Manual UI smoke test**

Run: `npm run dev`
Steps:
1. Open the Scheduler page.
2. Create a new task — confirm the new "Before each run" section is visible with three options and "Keep context" pre-selected.
3. Select "Clear context", save, reopen the task — confirm the selection is persisted.
4. Select "Compact", save, reopen — confirm persistence.
5. Select "Keep context", save, reopen — confirm persistence.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/scheduler/TaskFormModal.tsx
git commit -m "scheduler(ui): add pre-run context action radio in task form"
```

---

## Phase 5 — Final verification

### Task 5.1: Full test + build + manual end-to-end

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: 0 failures. Existing test counts + the new cases from Task 1.4 and Tasks 2.3–2.5.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Manual e2e — clear path**

In `npm run dev`:
1. Create a recurring task (e.g. every 1 minute), `pre_run_action = 'clear'`, prompt like `Say "hello" and nothing else`.
2. Let it run twice.
3. Open the conversation attached to the task. Confirm that on the second run the AI's response is isolated (no reference to the first run's context).

- [ ] **Step 4: Manual e2e — compact path**

1. Update the same task to `pre_run_action = 'compact'`.
2. Manually add some user/assistant messages in the attached conversation to build history.
3. Run the task now via the "Run now" button.
4. Confirm in the conversation that `compact_summary` appears (visible as the "previous conversation summary" marker) and that the next run's AI response considers the summary but not the raw history.

- [ ] **Step 5: Manual e2e — compact fallback**

1. Temporarily make Haiku unreachable (e.g. set an invalid `ai_apiKey` in settings).
2. Run the compact-enabled task.
3. Confirm in logs: the warning `compact failed, falling back to clear` is logged; the task still completes successfully; the next prompt is the first visible message to the AI.
4. Restore the API key.

- [ ] **Step 6: No-op commit (marker)** — **skip if nothing to commit**

If all manual tests pass with no tweaks needed, there's nothing to commit here. Move on.

---

## Self-review summary

Spec coverage check:

| Spec section | Covered by |
|---|---|
| §1 Data model | Task 1.2 |
| §2 Shared types | Task 1.1 |
| §3 CRUD | Task 1.3 |
| §4 `TaskRunContext` extension | Task 2.1 |
| §5 Orchestration in `executeTask` | Task 2.3 |
| §6 Entry-point implementations | Tasks 3.1–3.4 |
| §7 `Date.now() - 1` shift rationale | Implemented in Tasks 3.3, 3.4 |
| §8 UI | Task 4.1 |
| §9 Error handling (compact fallback) | Tasks 2.3 + 2.5 |
| §10 Testing (CRUD + executor + collision) | Tasks 1.4, 2.3–2.5 |
| §11 Scope (per-task, no cascade) | Inherent — no cascade code added |

**Collision mitigation test coverage:** the ms-collision scenario is covered indirectly by the orchestration tests (`callOrder` checks) rather than a dedicated unit test against a fake clock. Reason: the mitigation lives inside the entry-point impls (not the core orchestrator), and the entry-point `clearConversation` is just a SQL `UPDATE` with a `Date.now() - 1` — exercising it meaningfully requires a real DB with messages, which is Task 5.1's manual e2e. If a unit test against the main-process `createElectronContext` is desired later, add it in `src/main/services/scheduler.test.ts` as a follow-up.

**Out-of-scope items** (from spec §"Out of scope"): Discord/web-server task editors, token-thresholds. Not touched.
