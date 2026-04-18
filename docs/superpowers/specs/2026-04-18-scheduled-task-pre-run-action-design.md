# Scheduled Task — Pre-Run Context Action

**Date:** 2026-04-18
**Status:** Design approved (pending user spec review)

## Problem

Scheduled recurring tasks always reuse the same conversation (one conversation per task, created at task creation). Over many runs, the history grows unbounded and eventually exceeds the model's context window, causing silent truncation or failures. Users currently have no way to reset or summarize that history between runs without manually opening the conversation and typing `/clear` or `/compact`.

## Goals

- Let each scheduled task declare how its conversation should be prepared before every execution: keep as-is, clear, or compact.
- Reuse existing mechanisms (`cleared_at` soft-clear and the `/compact` Haiku summarizer) rather than adding a parallel flow.
- Keep the default behavior identical to today for existing tasks (no silent behavior change on upgrade).

## Non-Goals

- Automatic threshold-based clearing ("clear if > N tokens"). YAGNI — the user decides per task.
- Adding a new LLM pipeline. Compact reuses `compactConversation()` already in `core/handlers/messages.ts`.
- Changing how manual `/clear` and `/compact` behave in the chat UI.

## Design

### 1. Data model

New column on `scheduled_tasks`:

```
pre_run_action TEXT NOT NULL DEFAULT 'none'
```

Allowed values: `'none' | 'clear' | 'compact'`.

**Migration (additive):**

```ts
const schedCols = db.pragma('table_info(scheduled_tasks)') as { name: string }[]
if (!schedCols.some((c) => c.name === 'pre_run_action')) {
  try {
    db.exec("ALTER TABLE scheduled_tasks ADD COLUMN pre_run_action TEXT NOT NULL DEFAULT 'none'")
  } catch (e) {
    console.warn('[migration] scheduled_tasks.pre_run_action:', e)
  }
}
```

Existing rows get `'none'` → current behavior preserved.

### 2. Shared types

`src/shared/types.ts` (and wherever `ScheduledTask` / `CreateScheduledTask` are declared):

```ts
export type PreRunAction = 'none' | 'clear' | 'compact'

interface ScheduledTask {
  // ...existing fields
  pre_run_action: PreRunAction
}

interface CreateScheduledTask {
  // ...existing fields
  pre_run_action?: PreRunAction  // optional, defaults to 'none'
}
```

### 3. CRUD — `SchedulerService` (`src/core/services/scheduler.ts`)

- `rowToTask`: map `row.pre_run_action` with fallback `'none'` for resilience.
- `create()`: insert `data.pre_run_action ?? 'none'`. Validate against the allowed set.
- `update()`: handle `data.pre_run_action !== undefined` with validation.
- Add validator: `if (!['none', 'clear', 'compact'].includes(value)) throw new Error('invalid pre_run_action')`.

### 4. `TaskRunContext` extension (`src/core/services/taskExecutor.ts`)

```ts
export interface TaskRunContext {
  // ...existing fields
  clearConversation(conversationId: number): void
  compactConversation(conversationId: number): Promise<void>
}
```

### 5. Orchestration — `executeTask`

Insert **between** `getAISettings(...)` and the first `saveMessage('user', ...)`:

```ts
if (task.pre_run_action === 'clear') {
  ctx.clearConversation(task.conversation_id)
} else if (task.pre_run_action === 'compact') {
  try {
    await ctx.compactConversation(task.conversation_id)
  } catch (err) {
    console.warn(
      `[scheduler] Task "${task.name}" (id=${task.id}) compact failed, falling back to clear:`,
      err instanceof Error ? err.message : String(err)
    )
    ctx.clearConversation(task.conversation_id)
  }
}
```

Placing this **after** `getAISettings()` but **before** `saveMessage('user')` guarantees:
- The prompt sent to the model is the first visible message after the clear.
- AI settings (including `cwd`) are already captured — the clear has no impact on them.
- Variable resolution for the prompt (which happens after this block) is unaffected.

### 6. Entry-point implementations

**Electron main** (`src/main/services/scheduler.ts` or wherever `TaskRunContext` is assembled for the main process):

```ts
clearConversation(conversationId) {
  // Step back 1ms to avoid collision with the user message that follows within the same tick.
  const clearedAt = new Date(Date.now() - 1).toISOString()
  db.prepare(
    'UPDATE conversations SET cleared_at = ?, compact_summary = NULL, sdk_session_id = NULL, updated_at = ? WHERE id = ?'
  ).run(clearedAt, clearedAt, conversationId)
  onSessionInvalidate?.(conversationId)
},

async compactConversation(conversationId) {
  await compactConversationFn(db, conversationId, messagesHandlerOptions)
}
```

Where `compactConversationFn` is the **newly exported** `compactConversation` from `src/core/handlers/messages.ts` (currently private). One-line change: add `export`.

**Headless** (`src/headless/taskRunner.ts` / `src/headless/index.ts`): same two methods, backed by the same imports. Since `TaskRunContext` is already the injection point used by both Electron and headless, this just mirrors the main-process wiring.

### 7. Why the `Date.now() - 1` shift for clear

`buildMessageHistory` uses a **strict** filter: `AND created_at > ?` against `cleared_at`. In a synchronous flow (`clearConversation()` → `saveMessage('user', ...)`), both values are generated by `new Date().toISOString()` and can land on the exact same millisecond. Equal timestamps → the user message is excluded from history → the AI sees nothing.

Subtracting 1 ms from `cleared_at` guarantees the subsequent user message passes the strict filter. This is a local fix inside `clearConversation()`; the filter logic in `buildMessageHistory` is untouched.

**Compact path does not need this fix** — the awaited Haiku call naturally introduces multi-ms delay before the user message is saved.

### 8. UI — `TaskFormModal` (`src/renderer/components/scheduler/TaskFormModal.tsx`)

New state:

```ts
const [preRunAction, setPreRunAction] = useState<PreRunAction>(task?.pre_run_action ?? 'none')
```

New section placed **before** the toggles block (so context preparation logically precedes "after-run" concerns like notifications):

```
Before each run
  ● Keep context          (default)
  ○ Clear context
  ○ Compact (summarize, then clear)
```

Implementation pattern: same radio group pattern used for `maxRunsMode` (existing code, consistent style). A small helper hint below the compact option:

> Compact uses Haiku to summarize the previous run. Falls back to a plain clear if the summary fails.

`handleSubmit` passes `pre_run_action: preRunAction` to `onSave`.

### 9. Error handling

- **Invalid value on create/update** → validation error surfaced through `IPC error → modal error banner` (reuses existing `setError(...)` path).
- **Compact fails at runtime** → silent fallback to clear, warning logged. The task still runs. Rationale: the user's intent ("don't overflow context") is still satisfied; a transient Haiku/API blip shouldn't waste a scheduled run.
- **Clear fails at runtime** (UPDATE fails) → bubbles up, caught by `executeTask`'s top-level `catch`, task goes to `error` state via `markError`. No partial state: the user message is saved only after a successful clear.

### 10. Testing

**`src/core/services/taskExecutor.test.ts`** (new cases):
- `pre_run_action = 'none'` → `ctx.clearConversation` and `ctx.compactConversation` not called; history seen by `streamMessage` includes prior messages.
- `pre_run_action = 'clear'` → `ctx.clearConversation` called once before `saveMessage('user')`; `ctx.compactConversation` not called.
- `pre_run_action = 'compact'` (success) → `ctx.compactConversation` awaited before `saveMessage('user')`; `ctx.clearConversation` not called.
- `pre_run_action = 'compact'` (throws) → fallback: `ctx.clearConversation` called, warning logged, task still marked success.

**`src/core/services/scheduler.test.ts`** (new cases):
- `create()` without `pre_run_action` → row has `'none'`.
- `create()` with each valid value → row reflects it.
- `create()` / `update()` with invalid value → throws.
- `update()` mutates `pre_run_action`, retrieval reflects the change.

**Migration test** (in `src/core/db/schema.test.ts` or equivalent):
- Old DB without `pre_run_action` column → migration adds it with default `'none'` for existing rows.

**Integration-style test** for the ms-collision mitigation:
- With a fake clock that returns identical `Date.now()` across two consecutive synchronous calls, verify a user message saved immediately after `clearConversation()` is visible in `buildHistory` (i.e., `created_at > cleared_at` holds).

### 11. Cascade / scope

`pre_run_action` is **per-task only**, not cascaded from AI settings. Consistent with other per-task scheduler fields (`interval_value`, `notify_desktop`, etc.). No changes to `AIOverrides`, folder cascade, or conversation-level settings.

## Files touched

- `src/core/db/schema.ts` — migration block.
- `src/core/services/scheduler.ts` — CRUD + `rowToTask` + validation.
- `src/core/services/taskExecutor.ts` — `TaskRunContext` interface extension + orchestration block in `executeTask`.
- `src/core/handlers/messages.ts` — add `export` to `compactConversation`.
- `src/main/services/scheduler.ts` (or the main-process entry point that builds `TaskRunContext`) — wire `clearConversation` + `compactConversation` impls.
- `src/headless/taskRunner.ts` / `src/headless/index.ts` — mirror the wiring.
- `src/shared/types.ts` — `PreRunAction` + `ScheduledTask.pre_run_action` + `CreateScheduledTask.pre_run_action?`.
- `src/renderer/components/scheduler/TaskFormModal.tsx` — radio group + state + submit.
- Tests: `taskExecutor.test.ts`, `scheduler.test.ts`, `schema.test.ts`.

## Rollout

- Additive migration — no breaking change on existing data.
- Default `'none'` means existing tasks behave identically after upgrade.
- Feature is opt-in per task via the form.

## Out of scope (explicit)

- Token-based automatic clearing.
- Exposing the pre-run action in the Discord bot / web server UI task editors (those can follow in a separate change if needed — the backend is ready).
- Retaining the compact summary into the next run's "compact_summary" field for display. The existing `/compact` already does this; since we reuse it, the summary is written as before and visible in the conversation UI as usual.
