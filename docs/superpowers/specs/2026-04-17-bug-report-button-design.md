# Bug Report Button — Design

**Date:** 2026-04-17
**Author:** Laurent Baaziz (via Claude brainstorming)
**Status:** Approved, ready for implementation plan

## 1. Problem & goal

Add a "Report a bug" button to Agent Desktop so users can one-click-send a Discord embed containing recent error logs, a short user description, and relevant app metadata to a project-owned Discord webhook.

Today there is no central error collection, no in-app bug reporting, and users asking for help in the wild provide free-form descriptions with no context. Result: long back-and-forth to get environment info (Wayland vs X11, AI backend, version, etc.).

## 2. Scope

**In scope (V1):**
- Ring-buffered error capture in both main and renderer processes (errors only).
- Persistence of the main-process buffer across restarts, with size/count/age eviction.
- Automatic log scrubbing (user paths, emails, API-key-shaped tokens, bearer tokens) before preview.
- User-editable preview modal with optional description field.
- Three entry points: Settings → About, ErrorBoundary crash screen, system tray menu.
- Rate-limited send (30s client + 30s main) via Discord webhook (`net.fetch`).
- Project-owned webhook URL, injected at build time (not hardcoded in source).

**Explicitly out of scope (V1):**
- User-configurable webhook URL in settings.
- Capturing non-error log levels (`warn`, `info`).
- Persisting the renderer-process buffer.
- Bug report history / follow-ups.
- Anonymization beyond the scrubbing rules listed.

## 3. Decisions summary

| Decision | Choice | Rationale |
|---|---|---|
| Webhook URL source | Build-time env var (`MAIN_VITE_BUG_WEBHOOK_URL`) | Zero secret in repo; dev builds degrade gracefully. |
| What to capture | Ring buffer (main + renderer) of `console.error` / `window.onerror` / `unhandledrejection` | Broad enough to be useful, no log level noise. |
| Entry points | Settings → About + ErrorBoundary + tray menu | About = discoverable; ErrorBoundary = max context; tray = 1-click no matter where user is. |
| Privacy | Automatic scrubbing + user-editable preview | Defense in depth; user always sees final payload before send. |
| Metadata level | Standard + app context (version, OS, session X11/Wayland, Electron, Node, AI backend, theme, web mode) | Covers 80% of triage questions without leaking personal info. |
| Architecture | Two buffers (main + renderer), merged on-demand at report time | Zero IPC overhead in normal operation. |
| Buffer limits | count ≤ 50, size ≤ 10 KB total, TTL ≤ 60 min | Triple cap prevents both bloat and stale-data leak. |
| Persistence | Main buffer → `userData/error-buffer.json`, debounced 2s writes, atomic rename | Survives crash/restart; renderer buffer not persisted (no FS access + low value across sessions). |
| Rate-limit | 30s cooldown, in-memory both sides, no DB | Cheap, resets on restart (acceptable). |

## 4. Architecture — modules

All new modules are self-contained, expose a narrow public API via explicit entry points, and respect single-writer-per-file.

| Module | Process | Responsibility |
|---|---|---|
| `src/core/services/errorBuffer.ts` | shared (core) | Generic ring buffer class. API: `push(entry)`, `getAll()`, `clear()`, `onPush(cb) → unsubscribe`. Applies count / size / TTL eviction on `push` and `getAll`. Zero Electron dependency. |
| `src/main/bootstrap/mainErrorCapture.ts` | main | Patches `console.error` at boot. Calls original, then pushes to the shared main `ErrorBuffer`. Skips entries tagged `[bug-report-internal]`. |
| `src/renderer/bootstrap/rendererErrorCapture.ts` | renderer | Same pattern for renderer. Also captures `window.onerror` and `window.onunhandledrejection`. |
| `src/main/services/errorBufferPersist.ts` | main | Binds an `ErrorBuffer` to disk. `loadFromDisk(buffer, path)` + `attach(buffer, path)` installs a debounced (2s) listener that flushes JSON atomically (write-temp + rename). Handles missing/corrupt files silently. |
| `src/main/services/logScrubber.ts` | main | Named regex rules applied sequentially. API: `scrub(text): string`. One test per rule. |
| `src/main/services/bugReport.ts` | main | Orchestrates: get main buffer → scrub → build Discord embed → `net.fetch` POST with 10s timeout. Enforces main-side rate-limit. Returns `{ ok, error?, retryAfterMs? }`. |
| `src/core/handlers/bugReport.ts` | core handlers | Registers IPC: `bug:getMainErrors` (pulls main buffer), `bug:scrub` (scrubs arbitrary text), `bug:send` (submits final report). Wraps handlers with `try/catch` — never throws back to renderer. |
| `src/renderer/components/bugReport/BugReportModal.tsx` | renderer | Full-screen overlay modal. Textarea preview (editable) + optional description + Refresh logs button + Send/Cancel. Abort on unmount. |
| `src/renderer/stores/bugReportStore.ts` | renderer | Zustand store: `isOpen`, `prefillDescription`, `open(opts?)`, `close()`. No business logic. |

Extended modules:
- `src/main/services/tray.ts` — add "Report a bug…" menu item that sends `bugReport:open` IPC to renderer.
- `src/renderer/components/ErrorBoundary.tsx` — add "Report this crash" button next to "Try again", pre-fills description + pushes `error.stack` into renderer buffer before opening modal.
- `src/renderer/components/settings/AboutSection.tsx` — add "Signaler un bug" link/button under the version number.

Barrel updates (orchestrator-owned at integration time):
- `src/core/services/index.ts` → export `ErrorBuffer`, types.
- `src/core/handlers/index.ts` → register `bugReport` handlers.
- `src/renderer/stores/index.ts` (if exists) → export `useBugReportStore`.

## 5. Data flow

### 5.1 Error capture (continuous, normal operation)

```
┌──────────────── MAIN PROCESS ────────────────┐     ┌──────────────── RENDERER PROCESS ────────────────┐
│  [boot] mainErrorCapture.patch()             │     │  [boot] rendererErrorCapture.patch()             │
│  [boot] await loadFromDisk(buffer, path)     │     │                                                  │
│  [boot] attach(buffer, path)                 │     │                                                  │
│                                              │     │                                                  │
│  console.error(...)                          │     │  console.error(...)                              │
│    → patched:                                │     │  window.onerror(...)                             │
│      • originalError.apply() (stderr intact) │     │  window.onunhandledrejection(...)                │
│      • mainBuffer.push({ ts, source, msg })  │     │    → patched:                                    │
│      • (via onPush listener) debounced 2s    │     │      • originalError.apply() (devtools intact)   │
│        → atomic writeFile(JSON)              │     │      • rendererBuffer.push({ ts, source, msg })  │
└──────────────────────────────────────────────┘     └──────────────────────────────────────────────────┘
```

### 5.2 Report flow (user trigger)

```
[trigger: About btn / ErrorBoundary btn / tray menu]
    → bugReportStore.open({ prefillDescription?, prefillError? })
    → <BugReportModal> mounts
        → ipc.invoke('bug:getMainErrors')  → MainErrorEntry[]
        → merge with rendererBuffer.getAll(), sort by ISO timestamp
        → ipc.invoke('bug:scrub', merged)  → scrubbed text
        → fill preview textarea
    → user edits, writes description, clicks Send
    → ipc.invoke('bug:send', { description, logs })
        → bugReport.ts:
            1. rate-limit check (30s)
            2. build Discord embed (see §7)
            3. net.fetch(BUG_WEBHOOK_URL, { timeout: 10s, signal })
            4. return { ok, error?, retryAfterMs? }
    → modal shows toast, auto-closes on success after 1s
```

### 5.3 Boot ordering (main)

```
1. mainErrorCapture.patch()                             // ASAP, before any other import may log
2. await errorBufferPersist.loadFromDisk(buffer, path)  // hydrate before attach to avoid race
3. errorBufferPersist.attach(buffer, path)              // now listen for future pushes
4. enrichEnvironment()
5. await app.whenReady()
6. …rest of boot
```

### 5.4 `ErrorEntry` shape

```ts
interface ErrorEntry {
  timestamp: string              // ISO 8601, chronological-safe lexicographic sort
  source: 'main' | 'renderer'
  level: 'error'                 // reserved for future extension; always 'error' in V1
  message: string                // full formatted console output
}
```

## 6. Eviction policy

Applied on `push()` AND `getAll()` — stale entries do not survive the next read:

| Cap | Value | Action |
|---|---|---|
| Count | 50 entries | FIFO drop oldest |
| Size | 10 KB (sum of `message.length`) | FIFO drop oldest until under cap |
| Age (TTL) | 60 minutes | Drop any entry with `now - timestamp > TTL` |

TTL constant lives at module top: `const ERROR_BUFFER_TTL_MS = 60 * 60 * 1000`.

`loadFromDisk` re-runs eviction on every loaded entry, so dead sessions can't resurrect stale data.

## 7. Discord embed format

```json
{
  "username": "Agent Desktop Bug Reporter",
  "embeds": [{
    "title": "Bug Report",
    "color": 15158332,
    "timestamp": "<ISO now>",
    "description": "<user description or '_No description provided_'>",
    "fields": [
      { "name": "Version",    "value": "<app version>",          "inline": true },
      { "name": "Platform",   "value": "<os (arch)>",            "inline": true },
      { "name": "Session",    "value": "<X11|Wayland|unknown>",  "inline": true },
      { "name": "Electron",   "value": "<electron version>",     "inline": true },
      { "name": "Node",       "value": "<node version>",         "inline": true },
      { "name": "AI Backend", "value": "<claude-agent-sdk|pi>",  "inline": true },
      { "name": "Theme",      "value": "<theme id>",             "inline": true },
      { "name": "Web mode",   "value": "<yes|no>",               "inline": true },
      { "name": "Logs",       "value": "```\n<scrubbed logs>\n```", "inline": false }
    ],
    "footer": { "text": "Report ID: <uuid v4>" }
  }]
}
```

**Discord hard limits respected:**
- Embed description ≤ 4096 chars → user description truncated with `...\n[truncated]` suffix.
- Field value ≤ 1024 chars → long logs split into `Logs (1/N)`, `Logs (2/N)`, … fields.
- Total embed ≤ 6000 chars → last fields replaced by `...\n[truncated, N lines omitted]`.

## 8. Scrubbing rules

Module `logScrubber.ts` — ordered list of `{ name, regex, replacement }`, applied sequentially:

| Name | Pattern (conceptual) | Replacement |
|---|---|---|
| `homeDirPath` | `\b/home/[A-Za-z0-9_-]+` | `~` |
| `windowsUserPath` | `\bC:\\Users\\[^\\]+` | `C:\\Users\\~` |
| `emailAddress` | `\b[\w.+-]+@[\w-]+\.[\w.-]+\b` | `<email>` |
| `apiKeyLike` | `\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b` | `<redacted-key>` |
| `bearerToken` | `Bearer\s+[A-Za-z0-9._-]{20,}` | `Bearer <redacted>` |

Each rule has a dedicated unit test covering match + non-match cases. Extending = add one row + one test.

## 9. UI — Bug report modal

Full-screen overlay (same pattern as `SystemPromptEditorModal`), theme-variable-styled. Closable via Esc, backdrop click, or Cancel button.

Layout:
- **Title** "Report a bug" + close X.
- **Description** textarea (optional), placeholder "Que faisais-tu quand le bug est apparu ?".
- **Logs** textarea (editable, pre-filled with scrubbed merged logs) + **Refresh logs** button.
- **Info line**: "Metadata auto-ajoutées : version, OS, session, backend AI, thème actif."
- **Actions**: Cancel / Send.

Send button disabled when:
- Both description and logs are empty (at least one required).
- `sending === true`.
- Rate-limit active → button label becomes "Réessaye dans Xs" with countdown.

On success: toast, auto-close after 1s. On failure: toast with friendly message, modal stays open.

Unmount aborts any in-flight `fetch` via `AbortController`.

## 10. Entry points

1. **Settings → About** — button under the version number, opens modal with empty state.
2. **ErrorBoundary** — "Report this crash" button next to "Try again":
   - Pushes `{ timestamp, source: 'renderer', message: errorMessage + '\n' + errorStack }` into renderer buffer.
   - Calls `bugReportStore.open({ prefillDescription: 'UI crash: ' + error.message })`.
3. **Tray menu** — "Signaler un bug…" entry (uses existing tray handler pattern). Sends `bugReport:open` IPC to renderer → store opens modal.

## 11. Rate limiting

Two layers, 30-second cooldown each, in-memory only:

- **Client (modal)**: `lastSentAtMs` field in `bugReportStore`. Controls Send button state / countdown.
- **Main (`bugReport.ts`)**: module-level `lastSentAtMs`. Protects against renderer bugs/spam.

Main returns `{ ok: false, error: 'rate_limited', retryAfterMs }` on block → modal shows countdown.

No persistence: a restart resets the cooldown (restarts are deliberate, not abuse).

## 12. Webhook URL provisioning

- Referenced as `import.meta.env.MAIN_VITE_BUG_WEBHOOK_URL` in `bugReport.ts` (electron-vite requires the `MAIN_VITE_` prefix to expose env vars to the main process).
- Dev build: env var absent → `bugReport.send` short-circuits with `{ ok: false, error: 'not_configured' }` → modal shows "Fonctionnalité désactivée en développement". No crash.
- Prod build: injected via `electron-vite` build env (from `.env.production` or CI secret).
- `.env.production` added to `.gitignore` (or confirmed already ignored).

## 13. Error handling — non-happy paths

| Scenario | Behavior |
|---|---|
| `loadFromDisk`: file missing | Silent, start empty. |
| `loadFromDisk`: JSON corrupt | `console.warn`, delete file, start empty. |
| `flushToDisk`: I/O error | `console.warn`, continue. |
| `bug:getMainErrors` throws | Handler catches, returns `[]`. Modal shows partial-load message, still allows send. |
| Webhook: timeout 10s | `{ ok: false, error: 'timeout' }`. |
| Webhook: 4xx | `{ ok: false, error: 'invalid_webhook' }`. |
| Webhook: 5xx | `{ ok: false, error: 'server_error' }`. |
| Webhook URL absent | `{ ok: false, error: 'not_configured' }`. |
| Modal closed during send | `AbortController` cancels fetch. |
| Rate-limit hit | `{ ok: false, error: 'rate_limited', retryAfterMs }`. |

**Anti-loop guard**: `mainErrorCapture` and `rendererErrorCapture` tag their internal `console.error` calls with a sentinel prefix `[bug-report-internal]` and skip-push messages starting with that prefix. Prevents a bug in the scrubber or buffer from filling the buffer with its own errors.

No uncaught exceptions in bug-report code paths. `throw` in handlers is forbidden — every path returns a `Result`-shaped object.

## 14. Testing strategy

All tests colocated as `*.test.ts(x)` alongside sources. Coverage thresholds (70% lines / 60% branches) enforced by v8.

| Test file | Coverage |
|---|---|
| `errorBuffer.test.ts` | push / getAll / count eviction / size eviction / TTL eviction (mock `Date.now`) / `onPush` callback / unsubscribe / merge ordering |
| `mainErrorCapture.test.ts` | Patch preserves original `console.error` / pushes to buffer / skips `[bug-report-internal]` |
| `rendererErrorCapture.test.ts` | Same + `window.onerror` + `unhandledrejection` captured |
| `logScrubber.test.ts` | One test per rule (positive + negative) + sequential composition + no false positives on clean text |
| `errorBufferPersist.test.ts` | Load valid / load corrupt (deletes + empty) / debounce via `vi.useFakeTimers` / atomic write (temp + rename order) / missing file silent |
| `bugReport.test.ts` | Embed build with/without description / multi-field log split / truncation past 6000 chars / rate-limit (2nd rapid call refused) / `not_configured` path / `net.fetch` mock for 200/4xx/5xx/timeout |
| `core/handlers/bugReport.test.ts` | Handlers wrap errors / `bug:getMainErrors` returns `[]` on throw |
| `BugReportModal.test.tsx` | Mount pre-fills via mocked IPC / Send disabled when empty + when sending / countdown render when rate-limited / Esc closes / unmount aborts fetch |
| `bugReportStore.test.ts` | open/close / prefillDescription propagated / prefillError pushed into renderer buffer |

**Not tested**: real webhook URL, real FS (both mocked).

## 15. CLAUDE.md / project-rules conformance

| Rule | Compliance |
|---|---|
| New IPC handlers → `src/core/handlers/` | ✅ `bugReport` handler in core, not main |
| Async I/O only | ✅ All FS via `fs.promises.*` |
| Barrel files maintained | ✅ Core services + handlers barrels updated at integration |
| Single writer per file | ✅ Each process owns its buffer; scrubber main-only |
| Deep modules (Ousterhout) | ✅ `ErrorBuffer` exposes 4 methods, hides eviction + size accounting + listener list |
| No speculative abstraction | ✅ No generic `WebhookSender`; `bugReport.ts` and `webhook.ts` coexist (different knowledge) |
| Themes via CSS vars only | ✅ Modal uses `var(--color-*)` per convention |
| Settings cascade: not impacted | ✅ Bug reporter is app-wide; no conversation/folder/global layer |
| Tests colocated + async `createTestDb` respected | ✅ No DB involved; module-level tests only |
| Security: `net.fetch` only, https webhook | ✅ Webhook URL always https; no `openExternal` / no user-supplied URL in V1 |
| Main-thread I/O: no sync methods | ✅ All writes via `fs.promises` + atomic rename |

## 16. Open questions / deferred

- Should we extend capture to `console.warn`? Deferred — decide after collecting a few real-world reports to see if errors-only is enough signal.
- Should the webhook URL become user-configurable (Option C from the brainstorm)? Deferred — V1 ships with a single project-owned URL; user override is additive later.
- Persist renderer buffer across restarts? Deferred — low ROI, adds context-isolation plumbing.

## 17. Rollout

- Ship behind no feature flag — the feature is additive, low-risk, and degrades gracefully without the env var (dev/local builds show "disabled" state).
- Verify in a dev build that `not_configured` is the observed state before first prod build.
- On first prod build: set `MAIN_VITE_BUG_WEBHOOK_URL` in the build env (CI secret or `.env.production`), confirm one end-to-end report reaches Discord before announcing.
