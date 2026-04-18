# Bug Report Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app "Report a bug" button that sends a Discord-embed webhook with scrubbed recent error logs and app metadata.

**Architecture:** Two ring-buffered error captures (main + renderer) merged on demand, disk-persisted for the main buffer (atomic writes, debounce 2s), routed through a scrubber + Discord embed builder, triggered from three entry points (Settings→About, ErrorBoundary, tray menu). Single project-owned webhook URL injected at build time via `MAIN_VITE_BUG_WEBHOOK_URL`.

**Tech Stack:** Electron + React + Zustand + TypeScript + electron-vite. Tests: Vitest (main=node, renderer=jsdom), `@testing-library/react` v15.

**Spec:** `docs/superpowers/specs/2026-04-17-bug-report-button-design.md`

---

## File structure

### Create

| Path | Role |
|---|---|
| `src/core/services/errorBuffer.ts` | Generic ring buffer (count/size/TTL caps + `onPush`). |
| `src/core/services/errorBuffer.test.ts` | Unit tests for `ErrorBuffer`. |
| `src/main/services/logScrubber.ts` | Ordered regex rules + `scrub(text)` API. |
| `src/main/services/logScrubber.test.ts` | One test per rule + composition. |
| `src/main/services/errorBufferPersist.ts` | `loadFromDisk` + debounced atomic flush. |
| `src/main/services/errorBufferPersist.test.ts` | Load/flush/corrupt-file tests. |
| `src/main/bootstrap/mainErrorCapture.ts` | Patches main `console.error`. |
| `src/main/bootstrap/mainErrorCapture.test.ts` | Patch behavior tests. |
| `src/main/services/bugReport.ts` | Discord embed build + webhook POST + rate-limit. |
| `src/main/services/bugReport.test.ts` | Embed build / send / rate-limit / errors tests. |
| `src/core/handlers/bugReport.ts` | IPC handlers: `bug:getMainErrors`, `bug:scrub`, `bug:send`. |
| `src/core/handlers/bugReport.test.ts` | Handler wrapping tests. |
| `src/renderer/bootstrap/rendererErrorCapture.ts` | Patches renderer `console.error` + `window.onerror`. |
| `src/renderer/bootstrap/rendererErrorCapture.test.ts` | Patch behavior + global handlers tests. |
| `src/renderer/stores/bugReportStore.ts` | Zustand store. |
| `src/renderer/stores/bugReportStore.test.ts` | Store tests. |
| `src/renderer/components/bugReport/BugReportModal.tsx` | Modal UI. |
| `src/renderer/components/bugReport/BugReportModal.test.tsx` | Component tests. |

### Modify

| Path | Reason |
|---|---|
| `src/core/handlers/index.ts` | Register `registerBugReportHandlers`. |
| `src/core/index.ts` | Export `ErrorBuffer` + types. |
| `src/preload/index.ts` | Expose `window.agent.bugReport.*`. |
| `src/preload/api.d.ts` | Type the new `bugReport` API surface. |
| `src/main/index.ts` | Call `mainErrorCapture.patch()` ASAP, load persist, attach. |
| `src/renderer/src/main.tsx` (or entry) | Call `rendererErrorCapture.patch()` at boot. |
| `src/main/services/tray.ts` | Add "Report a bug…" menu item. |
| `src/renderer/components/ErrorBoundary.tsx` | Add "Report this crash" button. |
| `src/renderer/components/settings/AboutSection.tsx` | Add "Signaler un bug" button. |
| `.gitignore` | Add `.env.production`. |

---

## Conventions recap (from CLAUDE.md)

- Tests colocated as `*.test.ts(x)`.
- Async I/O only (`fs.promises.*`) on main thread.
- New IPC handlers live in `src/core/handlers/`, registered via `HandleRegistrar`.
- Preload exposes every channel via `window.agent.<category>.<method>`.
- CSS via theme variables (`var(--color-*)`) only — no hardcoded hex.
- Commit message format from recent history: lowercase type prefix (`feat:`, `fix:`, `chore:`, `docs:`), short description.

---

## Task 1: ErrorBuffer (core ring buffer)

**Files:**
- Create: `src/core/services/errorBuffer.ts`
- Test: `src/core/services/errorBuffer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/core/services/errorBuffer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer, type ErrorEntry } from './errorBuffer'

function entry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    timestamp: '2026-04-18T10:00:00.000Z',
    source: 'main',
    level: 'error',
    message: 'boom',
    ...overrides,
  }
}

describe('ErrorBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores pushed entries in FIFO order', () => {
    const buf = new ErrorBuffer()
    buf.push(entry({ message: 'a' }))
    buf.push(entry({ message: 'b' }))
    expect(buf.getAll().map((e) => e.message)).toEqual(['a', 'b'])
  })

  it('drops oldest entries when count > 50', () => {
    const buf = new ErrorBuffer()
    for (let i = 0; i < 55; i++) buf.push(entry({ message: String(i) }))
    const all = buf.getAll()
    expect(all).toHaveLength(50)
    expect(all[0].message).toBe('5')
    expect(all[49].message).toBe('54')
  })

  it('drops oldest entries when total size > 10KB', () => {
    const buf = new ErrorBuffer()
    const big = 'x'.repeat(2000)
    for (let i = 0; i < 10; i++) buf.push(entry({ message: big + i }))
    const total = buf.getAll().reduce((n, e) => n + e.message.length, 0)
    expect(total).toBeLessThanOrEqual(10_000)
  })

  it('evicts entries older than 60 min on push', () => {
    const buf = new ErrorBuffer()
    buf.push(entry({ timestamp: '2026-04-18T08:59:00.000Z', message: 'old' }))
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    buf.push(entry({ timestamp: '2026-04-18T10:00:00.000Z', message: 'new' }))
    expect(buf.getAll().map((e) => e.message)).toEqual(['new'])
  })

  it('evicts entries older than 60 min on getAll', () => {
    const buf = new ErrorBuffer()
    vi.setSystemTime(new Date('2026-04-18T09:00:00.000Z'))
    buf.push(entry({ timestamp: '2026-04-18T09:00:00.000Z', message: 'a' }))
    vi.setSystemTime(new Date('2026-04-18T10:30:00.000Z'))
    expect(buf.getAll()).toHaveLength(0)
  })

  it('notifies onPush listeners', () => {
    const buf = new ErrorBuffer()
    const cb = vi.fn()
    buf.onPush(cb)
    buf.push(entry())
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes onPush listeners', () => {
    const buf = new ErrorBuffer()
    const cb = vi.fn()
    const unsub = buf.onPush(cb)
    unsub()
    buf.push(entry())
    expect(cb).not.toHaveBeenCalled()
  })

  it('clear() empties the buffer', () => {
    const buf = new ErrorBuffer()
    buf.push(entry())
    buf.clear()
    expect(buf.getAll()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/services/errorBuffer.test.ts`
Expected: FAIL — "Failed to resolve import './errorBuffer'".

- [ ] **Step 3: Implement `ErrorBuffer`**

Create `src/core/services/errorBuffer.ts`:

```ts
export interface ErrorEntry {
  timestamp: string
  source: 'main' | 'renderer'
  level: 'error'
  message: string
}

export const ERROR_BUFFER_MAX_COUNT = 50
export const ERROR_BUFFER_MAX_BYTES = 10_000
export const ERROR_BUFFER_TTL_MS = 60 * 60 * 1000

type PushListener = () => void

export class ErrorBuffer {
  private entries: ErrorEntry[] = []
  private listeners: Set<PushListener> = new Set()

  push(entry: ErrorEntry): void {
    this.entries.push(entry)
    this.evict()
    this.listeners.forEach((cb) => {
      try {
        cb()
      } catch {
        // ignore listener failures
      }
    })
  }

  getAll(): ErrorEntry[] {
    this.evict()
    return [...this.entries]
  }

  clear(): void {
    this.entries = []
  }

  onPush(listener: PushListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private evict(): void {
    const now = Date.now()
    this.entries = this.entries.filter((e) => {
      const t = Date.parse(e.timestamp)
      return Number.isFinite(t) && now - t <= ERROR_BUFFER_TTL_MS
    })
    while (this.entries.length > ERROR_BUFFER_MAX_COUNT) {
      this.entries.shift()
    }
    let total = this.entries.reduce((n, e) => n + e.message.length, 0)
    while (total > ERROR_BUFFER_MAX_BYTES && this.entries.length > 0) {
      total -= this.entries[0].message.length
      this.entries.shift()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/services/errorBuffer.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/services/errorBuffer.ts src/core/services/errorBuffer.test.ts
git commit -m "feat(bug-report): add ErrorBuffer with count/size/ttl eviction"
```

---

## Task 2: Log scrubber

**Files:**
- Create: `src/main/services/logScrubber.ts`
- Test: `src/main/services/logScrubber.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/logScrubber.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scrub } from './logScrubber'

describe('logScrubber', () => {
  it('replaces linux home dir paths with ~', () => {
    expect(scrub('error at /home/alice/project/file.ts')).toBe('error at ~/project/file.ts')
  })

  it('replaces windows user paths with ~', () => {
    expect(scrub('error at C:\\Users\\Bob\\app.exe')).toBe('error at C:\\Users\\~\\app.exe')
  })

  it('replaces email addresses with <email>', () => {
    expect(scrub('contact alice@example.com for support')).toBe('contact <email> for support')
  })

  it('replaces openai-style keys with <redacted-key>', () => {
    expect(scrub('Authorization: sk-abcdefghijklmnopqrstuv')).toBe('Authorization: <redacted-key>')
  })

  it('replaces github tokens with <redacted-key>', () => {
    expect(scrub('token ghp_abcdefghijklmnopqrst')).toBe('token <redacted-key>')
  })

  it('replaces slack tokens with <redacted-key>', () => {
    expect(scrub('slack xoxb-1234567890-abcdef')).toBe('slack <redacted-key>')
  })

  it('replaces bearer tokens', () => {
    expect(scrub('Authorization: Bearer abcdef1234567890abcdef12'))
      .toBe('Authorization: Bearer <redacted>')
  })

  it('applies multiple rules sequentially', () => {
    const input = 'user alice@example.com at /home/alice/secrets with Bearer abcdef1234567890abcdef12'
    const out = scrub(input)
    expect(out).toContain('<email>')
    expect(out).toContain('~/secrets')
    expect(out).toContain('Bearer <redacted>')
    expect(out).not.toContain('alice@example.com')
    expect(out).not.toContain('/home/alice')
  })

  it('does not mutate innocent text', () => {
    const clean = 'normal log line with no secrets'
    expect(scrub(clean)).toBe(clean)
  })

  it('handles empty string', () => {
    expect(scrub('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/logScrubber.test.ts`
Expected: FAIL — import cannot be resolved.

- [ ] **Step 3: Implement `logScrubber`**

Create `src/main/services/logScrubber.ts`:

```ts
interface ScrubRule {
  name: string
  regex: RegExp
  replacement: string
}

const RULES: ScrubRule[] = [
  { name: 'homeDirPath', regex: /\/home\/[A-Za-z0-9_-]+/g, replacement: '~' },
  { name: 'windowsUserPath', regex: /C:\\Users\\[^\\]+/g, replacement: 'C:\\Users\\~' },
  { name: 'emailAddress', regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '<email>' },
  {
    name: 'apiKeyLike',
    regex: /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replacement: '<redacted-key>',
  },
  { name: 'bearerToken', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g, replacement: 'Bearer <redacted>' },
]

export function scrub(text: string): string {
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.regex, rule.replacement)
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/logScrubber.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/logScrubber.ts src/main/services/logScrubber.test.ts
git commit -m "feat(bug-report): add log scrubber with regex rules"
```

---

## Task 3: ErrorBuffer persistence

**Files:**
- Create: `src/main/services/errorBufferPersist.ts`
- Test: `src/main/services/errorBufferPersist.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/errorBufferPersist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer, type ErrorEntry } from '../../core/services/errorBuffer'

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}))

import { readFile, writeFile, rename, unlink } from 'fs/promises'
import { loadFromDisk, attachPersistence } from './errorBufferPersist'

const mockedReadFile = readFile as unknown as ReturnType<typeof vi.fn>
const mockedWriteFile = writeFile as unknown as ReturnType<typeof vi.fn>
const mockedRename = rename as unknown as ReturnType<typeof vi.fn>
const mockedUnlink = unlink as unknown as ReturnType<typeof vi.fn>

const entry: ErrorEntry = {
  timestamp: '2026-04-18T10:00:00.000Z',
  source: 'main',
  level: 'error',
  message: 'hello',
}

describe('errorBufferPersist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    mockedReadFile.mockReset()
    mockedWriteFile.mockReset()
    mockedRename.mockReset()
    mockedUnlink.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('loadFromDisk', () => {
    it('hydrates buffer from valid file', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify([entry]))
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(buf.getAll()).toHaveLength(1)
    })

    it('starts empty when file is missing', async () => {
      mockedReadFile.mockRejectedValueOnce(Object.assign(new Error('enoent'), { code: 'ENOENT' }))
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(buf.getAll()).toEqual([])
    })

    it('deletes corrupt file and starts empty', async () => {
      mockedReadFile.mockResolvedValueOnce('{not json')
      mockedUnlink.mockResolvedValueOnce(undefined)
      const buf = new ErrorBuffer()
      await loadFromDisk(buf, '/fake/path.json')
      expect(mockedUnlink).toHaveBeenCalledWith('/fake/path.json')
      expect(buf.getAll()).toEqual([])
    })
  })

  describe('attachPersistence', () => {
    it('writes atomically (temp + rename) after debounce', async () => {
      mockedWriteFile.mockResolvedValue(undefined)
      mockedRename.mockResolvedValue(undefined)
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      expect(mockedWriteFile).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockedWriteFile).toHaveBeenCalledTimes(1)
      const [tmpPath, payload] = mockedWriteFile.mock.calls[0]
      expect(tmpPath).toBe('/fake/path.json.tmp')
      expect(JSON.parse(payload as string)).toHaveLength(1)
      expect(mockedRename).toHaveBeenCalledWith('/fake/path.json.tmp', '/fake/path.json')
    })

    it('coalesces bursts into a single write', async () => {
      mockedWriteFile.mockResolvedValue(undefined)
      mockedRename.mockResolvedValue(undefined)
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      buf.push(entry)
      buf.push(entry)
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    })

    it('swallows I/O errors silently', async () => {
      mockedWriteFile.mockRejectedValue(new Error('disk full'))
      const buf = new ErrorBuffer()
      attachPersistence(buf, '/fake/path.json')
      buf.push(entry)
      await expect(vi.advanceTimersByTimeAsync(2000)).resolves.not.toThrow()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/errorBufferPersist.test.ts`
Expected: FAIL — import cannot be resolved.

- [ ] **Step 3: Implement `errorBufferPersist`**

Create `src/main/services/errorBufferPersist.ts`:

```ts
import { readFile, writeFile, rename, unlink } from 'fs/promises'
import type { ErrorBuffer, ErrorEntry } from '../../core/services/errorBuffer'

const FLUSH_DEBOUNCE_MS = 2000

export async function loadFromDisk(buffer: ErrorBuffer, path: string): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    console.warn('[errorBuffer] read failed, starting empty:', err)
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[errorBuffer] corrupt persist file, discarding')
    await unlink(path).catch(() => {})
    return
  }
  if (!Array.isArray(parsed)) return
  for (const entry of parsed) {
    if (isErrorEntry(entry)) buffer.push(entry)
  }
}

export function attachPersistence(buffer: ErrorBuffer, path: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = async (): Promise<void> => {
    timer = null
    const tmp = `${path}.tmp`
    const payload = JSON.stringify(buffer.getAll())
    try {
      await writeFile(tmp, payload, 'utf8')
      await rename(tmp, path)
    } catch (err) {
      console.warn('[errorBuffer] flush failed:', err)
    }
  }

  const unsub = buffer.onPush(() => {
    if (timer !== null) return
    timer = setTimeout(() => {
      void flush()
    }, FLUSH_DEBOUNCE_MS)
  })

  return () => {
    unsub()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

function isErrorEntry(value: unknown): value is ErrorEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.timestamp === 'string' &&
    (v.source === 'main' || v.source === 'renderer') &&
    v.level === 'error' &&
    typeof v.message === 'string'
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/errorBufferPersist.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/errorBufferPersist.ts src/main/services/errorBufferPersist.test.ts
git commit -m "feat(bug-report): persist main error buffer with debounced atomic flush"
```

---

## Task 4: Main error capture (patch console.error)

**Files:**
- Create: `src/main/bootstrap/mainErrorCapture.ts`
- Test: `src/main/bootstrap/mainErrorCapture.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/bootstrap/mainErrorCapture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer } from '../../core/services/errorBuffer'
import { patchConsoleError, INTERNAL_LOG_PREFIX } from './mainErrorCapture'

describe('mainErrorCapture', () => {
  let originalError: typeof console.error
  beforeEach(() => {
    originalError = console.error
  })
  afterEach(() => {
    console.error = originalError
  })

  it('calls the original console.error', () => {
    const buf = new ErrorBuffer()
    const spy = vi.fn()
    console.error = spy
    const restore = patchConsoleError(buf)
    console.error('boom', 42)
    expect(spy).toHaveBeenCalledWith('boom', 42)
    restore()
  })

  it('pushes entries into the buffer', () => {
    const buf = new ErrorBuffer()
    console.error = vi.fn()
    const restore = patchConsoleError(buf)
    console.error('oops')
    expect(buf.getAll()).toHaveLength(1)
    expect(buf.getAll()[0].source).toBe('main')
    expect(buf.getAll()[0].message).toContain('oops')
    restore()
  })

  it('formats multiple args into a single message', () => {
    const buf = new ErrorBuffer()
    console.error = vi.fn()
    const restore = patchConsoleError(buf)
    console.error('prefix', { code: 42 }, 'suffix')
    expect(buf.getAll()[0].message).toContain('prefix')
    expect(buf.getAll()[0].message).toContain('42')
    expect(buf.getAll()[0].message).toContain('suffix')
    restore()
  })

  it('skips messages tagged with the internal prefix', () => {
    const buf = new ErrorBuffer()
    console.error = vi.fn()
    const restore = patchConsoleError(buf)
    console.error(`${INTERNAL_LOG_PREFIX} internal noise`)
    expect(buf.getAll()).toHaveLength(0)
    restore()
  })

  it('restore() undoes the patch', () => {
    const buf = new ErrorBuffer()
    const spy = vi.fn()
    console.error = spy
    const restore = patchConsoleError(buf)
    restore()
    console.error('after-restore')
    expect(buf.getAll()).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/bootstrap/mainErrorCapture.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement `mainErrorCapture`**

Create `src/main/bootstrap/mainErrorCapture.ts`:

```ts
import { inspect } from 'util'
import type { ErrorBuffer } from '../../core/services/errorBuffer'

export const INTERNAL_LOG_PREFIX = '[bug-report-internal]'

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 3, breakLength: 120 })))
    .join(' ')
}

export function patchConsoleError(buffer: ErrorBuffer): () => void {
  const original = console.error
  console.error = ((...args: unknown[]) => {
    try {
      original.apply(console, args)
      const message = formatArgs(args)
      if (message.startsWith(INTERNAL_LOG_PREFIX)) return
      buffer.push({
        timestamp: new Date().toISOString(),
        source: 'main',
        level: 'error',
        message,
      })
    } catch {
      // swallow: we cannot log here without recursing
    }
  }) as typeof console.error
  return () => {
    console.error = original
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/bootstrap/mainErrorCapture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/bootstrap/mainErrorCapture.ts src/main/bootstrap/mainErrorCapture.test.ts
git commit -m "feat(bug-report): capture main process console.error into buffer"
```

---

## Task 5: Bug report service (embed build + webhook POST + rate-limit)

**Files:**
- Create: `src/main/services/bugReport.ts`
- Test: `src/main/services/bugReport.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/bugReport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => mockFetch(...args) },
  app: { getVersion: () => '0.13.0' },
}))

import { sendBugReport, buildEmbed, resetRateLimitForTest } from './bugReport'

describe('buildEmbed', () => {
  it('includes all metadata fields', () => {
    const embed = buildEmbed({
      description: 'It crashed',
      logs: 'log content',
      metadata: {
        version: '0.13.0',
        platform: 'linux (x64)',
        session: 'Wayland',
        electron: '33.2.1',
        node: '20.18.1',
        aiBackend: 'claude-agent-sdk',
        theme: 'dark',
        webMode: 'no',
      },
    })
    const names = embed.fields.map((f) => f.name)
    expect(names).toEqual(
      expect.arrayContaining(['Version', 'Platform', 'Session', 'Electron', 'Node', 'AI Backend', 'Theme', 'Web mode']),
    )
    expect(embed.description).toBe('It crashed')
  })

  it('uses placeholder description when empty', () => {
    const embed = buildEmbed({
      description: '',
      logs: 'log',
      metadata: defaultMeta(),
    })
    expect(embed.description).toBe('_No description provided_')
  })

  it('splits long logs across multiple Logs fields', () => {
    const longLog = 'x'.repeat(3000)
    const embed = buildEmbed({ description: '', logs: longLog, metadata: defaultMeta() })
    const logFields = embed.fields.filter((f) => f.name.startsWith('Logs'))
    expect(logFields.length).toBeGreaterThan(1)
    expect(logFields[0].name).toMatch(/Logs \(1\/\d+\)/)
  })

  it('truncates embed when total exceeds 6000 chars', () => {
    const huge = 'x'.repeat(10_000)
    const embed = buildEmbed({ description: huge, logs: huge, metadata: defaultMeta() })
    const total = JSON.stringify(embed).length
    expect(total).toBeLessThanOrEqual(6200) // 6000 + JSON overhead tolerance
  })
})

describe('sendBugReport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'))
    mockFetch.mockReset()
    resetRateLimitForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns not_configured when webhook url is empty', async () => {
    const res = await sendBugReport({ description: 'x', logs: '', metadata: defaultMeta() }, '')
    expect(res).toEqual({ ok: false, error: 'not_configured' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('posts embed payload and returns ok on 204', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://discord.example/webhook',
    )
    expect(res).toEqual({ ok: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://discord.example/webhook')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.embeds).toHaveLength(1)
  })

  it('returns server_error on 5xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'server_error' })
  })

  it('returns invalid_webhook on 4xx', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'invalid_webhook' })
  })

  it('returns timeout when fetch throws AbortError', async () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    mockFetch.mockRejectedValueOnce(err)
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: false, error: 'timeout' })
  })

  it('rate-limits second rapid call', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response)
    await sendBugReport({ description: 'd', logs: 'l', metadata: defaultMeta() }, 'https://x')
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res.ok).toBe(false)
    expect(res.error).toBe('rate_limited')
    expect(res.retryAfterMs).toBeGreaterThan(0)
    expect(res.retryAfterMs).toBeLessThanOrEqual(30_000)
  })

  it('allows second call after 30s cooldown', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response)
    await sendBugReport({ description: 'd', logs: 'l', metadata: defaultMeta() }, 'https://x')
    vi.setSystemTime(new Date('2026-04-18T10:00:31.000Z'))
    const res = await sendBugReport(
      { description: 'd', logs: 'l', metadata: defaultMeta() },
      'https://x',
    )
    expect(res).toEqual({ ok: true })
  })
})

function defaultMeta() {
  return {
    version: '0.13.0',
    platform: 'linux (x64)',
    session: 'Wayland' as const,
    electron: '33.2.1',
    node: '20.18.1',
    aiBackend: 'claude-agent-sdk',
    theme: 'dark',
    webMode: 'no' as const,
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/services/bugReport.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement `bugReport` service**

Create `src/main/services/bugReport.ts`:

```ts
import { net } from 'electron'

export interface BugReportMetadata {
  version: string
  platform: string
  session: 'X11' | 'Wayland' | 'unknown'
  electron: string
  node: string
  aiBackend: string
  theme: string
  webMode: 'yes' | 'no'
}

export interface BugReportPayload {
  description: string
  logs: string
  metadata: BugReportMetadata
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number }

interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title: string
  color: number
  timestamp: string
  description: string
  fields: DiscordEmbedField[]
  footer: { text: string }
}

const RATE_LIMIT_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_EMBED_TOTAL = 6000
const MAX_FIELD_VALUE = 1024
const MAX_DESCRIPTION = 4000
const LOG_CODEFENCE_OVERHEAD = 10 // ```\n + \n``` + buffer

let lastSentAtMs = 0

export function resetRateLimitForTest(): void {
  lastSentAtMs = 0
}

function randomUuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as { randomUUID: () => string }).randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const suffix = '\n[truncated]'
  return text.slice(0, max - suffix.length) + suffix
}

function splitLogs(logs: string): DiscordEmbedField[] {
  if (!logs.trim()) {
    return [{ name: 'Logs', value: '```\n<no logs captured>\n```', inline: false }]
  }
  const chunkSize = MAX_FIELD_VALUE - LOG_CODEFENCE_OVERHEAD
  const chunks: string[] = []
  for (let i = 0; i < logs.length; i += chunkSize) {
    chunks.push(logs.slice(i, i + chunkSize))
  }
  const total = chunks.length
  return chunks.map((c, i) => ({
    name: total === 1 ? 'Logs' : `Logs (${i + 1}/${total})`,
    value: '```\n' + c + '\n```',
    inline: false,
  }))
}

export function buildEmbed(payload: BugReportPayload): DiscordEmbed {
  const m = payload.metadata
  const metaFields: DiscordEmbedField[] = [
    { name: 'Version', value: m.version, inline: true },
    { name: 'Platform', value: m.platform, inline: true },
    { name: 'Session', value: m.session, inline: true },
    { name: 'Electron', value: m.electron, inline: true },
    { name: 'Node', value: m.node, inline: true },
    { name: 'AI Backend', value: m.aiBackend, inline: true },
    { name: 'Theme', value: m.theme, inline: true },
    { name: 'Web mode', value: m.webMode, inline: true },
  ]
  const description = payload.description.trim()
    ? truncate(payload.description, MAX_DESCRIPTION)
    : '_No description provided_'

  const logFields = splitLogs(payload.logs)
  let fields = [...metaFields, ...logFields]

  let embed: DiscordEmbed = {
    title: 'Bug Report',
    color: 15158332,
    timestamp: new Date().toISOString(),
    description,
    fields,
    footer: { text: `Report ID: ${randomUuid()}` },
  }

  // Truncate tail of log fields if total exceeds MAX_EMBED_TOTAL
  while (JSON.stringify(embed).length > MAX_EMBED_TOTAL && fields.length > metaFields.length) {
    const dropped = fields.length - metaFields.length
    fields = fields.slice(0, -1)
    const last = fields[fields.length - 1]
    if (last && last.name.startsWith('Logs')) {
      last.value = last.value.replace(/\n```$/, `\n[truncated, ${dropped} chunk(s) omitted]\n\`\`\``)
    }
    embed = { ...embed, fields }
  }

  return embed
}

export async function sendBugReport(
  payload: BugReportPayload,
  webhookUrl: string,
): Promise<SendResult> {
  if (!webhookUrl) return { ok: false, error: 'not_configured' }

  const now = Date.now()
  const since = now - lastSentAtMs
  if (since < RATE_LIMIT_MS) {
    return { ok: false, error: 'rate_limited', retryAfterMs: RATE_LIMIT_MS - since }
  }

  const embed = buildEmbed(payload)
  const body = JSON.stringify({
    username: 'Agent Desktop Bug Reporter',
    embeds: [embed],
  })

  try {
    const res = await net.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) {
      lastSentAtMs = Date.now()
      return { ok: true }
    }
    if (res.status >= 500) return { ok: false, error: 'server_error' }
    if (res.status >= 400) return { ok: false, error: 'invalid_webhook' }
    return { ok: false, error: 'unknown' }
  } catch (err) {
    const name = (err as Error).name
    if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'unknown' }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/services/bugReport.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/bugReport.ts src/main/services/bugReport.test.ts
git commit -m "feat(bug-report): add Discord embed builder and webhook sender"
```

---

## Task 6: IPC handlers (`bug:getMainErrors`, `bug:scrub`, `bug:send`)

**Files:**
- Create: `src/core/handlers/bugReport.ts`
- Test: `src/core/handlers/bugReport.test.ts`
- Modify: `src/core/handlers/index.ts`

- [ ] **Step 1: Write failing tests**

Create `src/core/handlers/bugReport.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer } from '../services/errorBuffer'
import { DispatchRegistry } from '../dispatch'

vi.mock('../../main/services/bugReport', () => ({
  sendBugReport: vi.fn(),
}))
vi.mock('../../main/services/logScrubber', () => ({
  scrub: (s: string) => s.replace('/home/alice', '~'),
}))

import { sendBugReport } from '../../main/services/bugReport'
import { registerBugReportHandlers } from './bugReport'

const mockedSend = sendBugReport as unknown as ReturnType<typeof vi.fn>

describe('bugReport handlers', () => {
  beforeEach(() => {
    mockedSend.mockReset()
  })

  it('bug:getMainErrors returns buffer contents', async () => {
    const buf = new ErrorBuffer()
    buf.push({
      timestamp: '2026-04-18T10:00:00.000Z',
      source: 'main',
      level: 'error',
      message: 'boom',
    })
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: buf,
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const result = await reg.invoke('bug:getMainErrors', null)
    expect(result).toHaveLength(1)
  })

  it('bug:getMainErrors returns [] if buffer throws', async () => {
    const buf = { getAll: () => { throw new Error('bad') } } as unknown as ErrorBuffer
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: buf,
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const result = await reg.invoke('bug:getMainErrors', null)
    expect(result).toEqual([])
  })

  it('bug:scrub applies scrubber to input string', async () => {
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => '',
    })
    const out = await reg.invoke('bug:scrub', null, '/home/alice/x')
    expect(out).toBe('~/x')
  })

  it('bug:send delegates to sendBugReport with metadata + url', async () => {
    mockedSend.mockResolvedValueOnce({ ok: true })
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => 'https://x',
    })
    const res = await reg.invoke('bug:send', null, { description: 'd', logs: 'l' })
    expect(res).toEqual({ ok: true })
    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'd', logs: 'l' }),
      'https://x',
    )
  })

  it('bug:send returns { ok:false, error:unknown } when send throws', async () => {
    mockedSend.mockRejectedValueOnce(new Error('unexpected'))
    const reg = new DispatchRegistry()
    registerBugReportHandlers(reg, {
      mainBuffer: new ErrorBuffer(),
      getMetadata: async () => metaFixture(),
      getWebhookUrl: () => 'https://x',
    })
    const res = await reg.invoke('bug:send', null, { description: 'd', logs: 'l' })
    expect(res).toEqual({ ok: false, error: 'unknown' })
  })
})

function metaFixture() {
  return {
    version: '0.13.0',
    platform: 'linux (x64)',
    session: 'Wayland' as const,
    electron: '33.2.1',
    node: '20.18.1',
    aiBackend: 'claude-agent-sdk',
    theme: 'dark',
    webMode: 'no' as const,
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/handlers/bugReport.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement handlers**

Create `src/core/handlers/bugReport.ts`:

```ts
import type { HandleRegistrar } from '../dispatch'
import type { ErrorBuffer } from '../services/errorBuffer'
import { sendBugReport, type BugReportMetadata } from '../../main/services/bugReport'
import { scrub } from '../../main/services/logScrubber'

export interface BugReportHandlerOptions {
  mainBuffer: ErrorBuffer
  getMetadata: () => Promise<BugReportMetadata>
  getWebhookUrl: () => string
}

export function registerBugReportHandlers(
  registrar: HandleRegistrar,
  opts: BugReportHandlerOptions,
): void {
  registrar.handle('bug:getMainErrors', async () => {
    try {
      return opts.mainBuffer.getAll()
    } catch (err) {
      console.warn('[bug-report-internal] getMainErrors failed:', err)
      return []
    }
  })

  registrar.handle('bug:scrub', async (_event, text: unknown) => {
    if (typeof text !== 'string') return ''
    try {
      return scrub(text)
    } catch (err) {
      console.warn('[bug-report-internal] scrub failed:', err)
      return text
    }
  })

  registrar.handle('bug:send', async (_event, payload: unknown) => {
    try {
      const { description, logs } = (payload ?? {}) as { description?: unknown; logs?: unknown }
      const metadata = await opts.getMetadata()
      return await sendBugReport(
        {
          description: typeof description === 'string' ? description : '',
          logs: typeof logs === 'string' ? logs : '',
          metadata,
        },
        opts.getWebhookUrl(),
      )
    } catch (err) {
      console.warn('[bug-report-internal] send failed:', err)
      return { ok: false, error: 'unknown' as const }
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/handlers/bugReport.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire handlers into `registerCoreHandlers`**

Edit `src/core/handlers/index.ts`:

1. Add the import alongside the others:
   ```ts
   import { registerBugReportHandlers } from './bugReport'
   ```
2. Extend `CoreHandlerOptions`:
   ```ts
   export interface CoreHandlerOptions {
     broadcaster: Broadcaster
     hookRunner: HookRunner
     sessionsBase: string
     themesDir: string
     knowledgesDir: string
     bugReport: {
       mainBuffer: import('../services/errorBuffer').ErrorBuffer
       getMetadata: () => Promise<import('../../main/services/bugReport').BugReportMetadata>
       getWebhookUrl: () => string
     }
   }
   ```
3. Call it inside `registerCoreHandlers` (end of the function body):
   ```ts
   registerBugReportHandlers(registrar, options.bugReport)
   ```

- [ ] **Step 6: Run full test suite to confirm nothing regressed**

Run: `npx vitest run src/core/handlers`
Expected: all handler tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/handlers/bugReport.ts src/core/handlers/bugReport.test.ts src/core/handlers/index.ts
git commit -m "feat(bug-report): add IPC handlers for buffer/scrub/send"
```

---

## Task 7: Renderer error capture

**Files:**
- Create: `src/renderer/bootstrap/rendererErrorCapture.ts`
- Test: `src/renderer/bootstrap/rendererErrorCapture.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/bootstrap/rendererErrorCapture.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ErrorBuffer } from '../../core/services/errorBuffer'
import {
  patchRendererConsoleError,
  installGlobalErrorHandlers,
  INTERNAL_LOG_PREFIX,
} from './rendererErrorCapture'

describe('rendererErrorCapture', () => {
  let originalError: typeof console.error
  beforeEach(() => {
    originalError = console.error
  })
  afterEach(() => {
    console.error = originalError
  })

  it('patchRendererConsoleError pushes entries with source=renderer', () => {
    const buf = new ErrorBuffer()
    console.error = vi.fn()
    const restore = patchRendererConsoleError(buf)
    console.error('oops')
    const all = buf.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].source).toBe('renderer')
    restore()
  })

  it('patchRendererConsoleError preserves original', () => {
    const buf = new ErrorBuffer()
    const spy = vi.fn()
    console.error = spy
    const restore = patchRendererConsoleError(buf)
    console.error('a', 1)
    expect(spy).toHaveBeenCalledWith('a', 1)
    restore()
  })

  it('skips internal-prefixed messages', () => {
    const buf = new ErrorBuffer()
    console.error = vi.fn()
    const restore = patchRendererConsoleError(buf)
    console.error(`${INTERNAL_LOG_PREFIX} noise`)
    expect(buf.getAll()).toEqual([])
    restore()
  })

  it('installGlobalErrorHandlers captures window.onerror', () => {
    const buf = new ErrorBuffer()
    const restore = installGlobalErrorHandlers(buf)
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', filename: 'f.js', lineno: 1, colno: 1 }),
    )
    expect(buf.getAll()).toHaveLength(1)
    expect(buf.getAll()[0].message).toContain('boom')
    restore()
  })

  it('installGlobalErrorHandlers captures unhandledrejection', () => {
    const buf = new ErrorBuffer()
    const restore = installGlobalErrorHandlers(buf)
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: new Error('rej') })
    window.dispatchEvent(rejection)
    expect(buf.getAll()).toHaveLength(1)
    expect(buf.getAll()[0].message).toContain('rej')
    restore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/bootstrap/rendererErrorCapture.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement renderer capture**

Create `src/renderer/bootstrap/rendererErrorCapture.ts`:

```ts
import { ErrorBuffer } from '../../core/services/errorBuffer'

export const INTERNAL_LOG_PREFIX = '[bug-report-internal]'

export const rendererErrorBuffer = new ErrorBuffer()

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

export function patchRendererConsoleError(buffer: ErrorBuffer): () => void {
  const original = console.error
  console.error = ((...args: unknown[]) => {
    try {
      original.apply(console, args)
      const message = formatArgs(args)
      if (message.startsWith(INTERNAL_LOG_PREFIX)) return
      buffer.push({
        timestamp: new Date().toISOString(),
        source: 'renderer',
        level: 'error',
        message,
      })
    } catch {
      // never throw from a patched console
    }
  }) as typeof console.error
  return () => {
    console.error = original
  }
}

export function installGlobalErrorHandlers(buffer: ErrorBuffer): () => void {
  const onError = (ev: ErrorEvent): void => {
    buffer.push({
      timestamp: new Date().toISOString(),
      source: 'renderer',
      level: 'error',
      message: `window.onerror: ${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`,
    })
  }
  const onRejection = (ev: PromiseRejectionEvent): void => {
    const reason = ev.reason
    const text =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
        : String(reason)
    buffer.push({
      timestamp: new Date().toISOString(),
      source: 'renderer',
      level: 'error',
      message: `unhandledrejection: ${text}`,
    })
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/bootstrap/rendererErrorCapture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/bootstrap/rendererErrorCapture.ts src/renderer/bootstrap/rendererErrorCapture.test.ts
git commit -m "feat(bug-report): capture renderer console.error + window globals"
```

---

## Task 8: Preload API + type surface

**Files:**
- Modify: `src/preload/api.d.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the `bugReport` surface to `api.d.ts`**

Open `src/preload/api.d.ts`. Find the existing `AgentAPI` interface and add a new section:

```ts
  bugReport: {
    getMainErrors(): Promise<
      Array<{ timestamp: string; source: 'main' | 'renderer'; level: 'error'; message: string }>
    >
    scrub(text: string): Promise<string>
    send(payload: { description: string; logs: string }): Promise<
      | { ok: true }
      | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
      | { ok: false; error: 'rate_limited'; retryAfterMs: number }
    >
    onOpenRequest(cb: () => void): () => void
  }
```

Place it alphabetically near existing members (e.g., after `auth` or in logical grouping).

- [ ] **Step 2: Implement the preload bridge**

Open `src/preload/index.ts`. In the `api` object, add:

```ts
  bugReport: {
    getMainErrors: () => withTimeout(ipcRenderer.invoke('bug:getMainErrors')),
    scrub: (text: string) => withTimeout(ipcRenderer.invoke('bug:scrub', text)),
    send: (payload: { description: string; logs: string }) =>
      withTimeout(ipcRenderer.invoke('bug:send', payload), 15000),
    onOpenRequest: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('bugReport:open', handler)
      return () => {
        ipcRenderer.removeListener('bugReport:open', handler)
      }
    },
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run build` (or `npx tsc --noEmit -p tsconfig.json`)
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/api.d.ts src/preload/index.ts
git commit -m "feat(bug-report): expose bugReport API via preload bridge"
```

---

## Task 9: Zustand bug report store

**Files:**
- Create: `src/renderer/stores/bugReportStore.ts`
- Test: `src/renderer/stores/bugReportStore.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/stores/bugReportStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useBugReportStore } from './bugReportStore'

beforeEach(() => {
  useBugReportStore.setState({ isOpen: false, prefillDescription: '', lastSentAtMs: 0 })
})

describe('bugReportStore', () => {
  it('open() sets isOpen=true', () => {
    useBugReportStore.getState().open()
    expect(useBugReportStore.getState().isOpen).toBe(true)
  })

  it('open() accepts prefillDescription', () => {
    useBugReportStore.getState().open({ prefillDescription: 'crash at X' })
    expect(useBugReportStore.getState().prefillDescription).toBe('crash at X')
  })

  it('close() resets state', () => {
    useBugReportStore.getState().open({ prefillDescription: 'x' })
    useBugReportStore.getState().close()
    const s = useBugReportStore.getState()
    expect(s.isOpen).toBe(false)
    expect(s.prefillDescription).toBe('')
  })

  it('markSent() records timestamp', () => {
    useBugReportStore.getState().markSent()
    expect(useBugReportStore.getState().lastSentAtMs).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/stores/bugReportStore.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement the store**

Create `src/renderer/stores/bugReportStore.ts`:

```ts
import { create } from 'zustand'

interface BugReportState {
  isOpen: boolean
  prefillDescription: string
  lastSentAtMs: number
  open: (opts?: { prefillDescription?: string }) => void
  close: () => void
  markSent: () => void
}

export const useBugReportStore = create<BugReportState>((set) => ({
  isOpen: false,
  prefillDescription: '',
  lastSentAtMs: 0,
  open: (opts) =>
    set({
      isOpen: true,
      prefillDescription: opts?.prefillDescription ?? '',
    }),
  close: () =>
    set({
      isOpen: false,
      prefillDescription: '',
    }),
  markSent: () => set({ lastSentAtMs: Date.now() }),
}))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/stores/bugReportStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/stores/bugReportStore.ts src/renderer/stores/bugReportStore.test.ts
git commit -m "feat(bug-report): add Zustand store for modal state"
```

---

## Task 10: Bug report modal component

**Files:**
- Create: `src/renderer/components/bugReport/BugReportModal.tsx`
- Test: `src/renderer/components/bugReport/BugReportModal.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/components/bugReport/BugReportModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { BugReportModal } from './BugReportModal'
import { useBugReportStore } from '../../stores/bugReportStore'
import { rendererErrorBuffer } from '../../bootstrap/rendererErrorCapture'

const agentMock = {
  bugReport: {
    getMainErrors: vi.fn(),
    scrub: vi.fn((s: string) => Promise.resolve(s)),
    send: vi.fn(),
  },
}
;(global as unknown as { window: { agent: unknown } }).window.agent = agentMock

beforeEach(() => {
  useBugReportStore.setState({ isOpen: true, prefillDescription: '', lastSentAtMs: 0 })
  rendererErrorBuffer.clear()
  agentMock.bugReport.getMainErrors.mockReset().mockResolvedValue([])
  agentMock.bugReport.scrub.mockReset().mockImplementation((s: string) => Promise.resolve(s))
  agentMock.bugReport.send.mockReset().mockResolvedValue({ ok: true })
})

describe('BugReportModal', () => {
  it('loads and displays scrubbed logs on mount', async () => {
    agentMock.bugReport.getMainErrors.mockResolvedValue([
      { timestamp: '2026-04-18T10:00:00.000Z', source: 'main', level: 'error', message: 'boom' },
    ])
    render(<BugReportModal />)
    await waitFor(() => {
      const ta = screen.getByTestId('bug-logs-textarea') as HTMLTextAreaElement
      expect(ta.value).toContain('boom')
    })
  })

  it('disables Send when both description and logs are empty', async () => {
    render(<BugReportModal />)
    await waitFor(() => {
      expect(screen.getByTestId('bug-send-button')).toBeDisabled()
    })
  })

  it('enables Send when description has text', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), {
      target: { value: 'crash' },
    })
    expect(screen.getByTestId('bug-send-button')).not.toBeDisabled()
  })

  it('calls window.agent.bugReport.send on Send click', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), {
      target: { value: 'crash' },
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('bug-send-button'))
    })
    expect(agentMock.bugReport.send).toHaveBeenCalledWith({
      description: 'crash',
      logs: expect.any(String),
    })
  })

  it('shows rate-limit countdown when send returns rate_limited', async () => {
    agentMock.bugReport.send.mockResolvedValue({ ok: false, error: 'rate_limited', retryAfterMs: 12000 })
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-send-button')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('bug-description-textarea'), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('bug-send-button'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('bug-send-button')).toHaveTextContent(/12s/)
    })
  })

  it('closes modal on Cancel', async () => {
    render(<BugReportModal />)
    await waitFor(() => expect(screen.getByTestId('bug-cancel-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('bug-cancel-button'))
    expect(useBugReportStore.getState().isOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/bugReport/BugReportModal.test.tsx`
Expected: FAIL — file missing.

- [ ] **Step 3: Implement the modal**

Create `src/renderer/components/bugReport/BugReportModal.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useBugReportStore } from '../../stores/bugReportStore'
import { rendererErrorBuffer } from '../../bootstrap/rendererErrorCapture'

type SendResult =
  | { ok: true }
  | { ok: false; error: 'not_configured' | 'timeout' | 'invalid_webhook' | 'server_error' | 'unknown' }
  | { ok: false; error: 'rate_limited'; retryAfterMs: number }

function formatEntry(e: {
  timestamp: string
  source: string
  level: string
  message: string
}): string {
  return `[${e.timestamp}] [${e.source}] ${e.message}`
}

export function BugReportModal(): JSX.Element | null {
  const isOpen = useBugReportStore((s) => s.isOpen)
  const prefillDescription = useBugReportStore((s) => s.prefillDescription)
  const close = useBugReportStore((s) => s.close)
  const markSent = useBugReportStore((s) => s.markSent)

  const [description, setDescription] = useState('')
  const [logs, setLogs] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setDescription(prefillDescription)
    setError(null)
    void refreshLogs()
    return () => {
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  async function refreshLogs(): Promise<void> {
    try {
      const main = await window.agent.bugReport.getMainErrors()
      const renderer = rendererErrorBuffer.getAll()
      const merged = [...main, ...renderer].sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
      )
      const raw = merged.map(formatEntry).join('\n')
      const scrubbed = await window.agent.bugReport.scrub(raw)
      setLogs(scrubbed)
    } catch {
      setLogs('')
    }
  }

  function startCountdown(ms: number): void {
    setCountdown(Math.ceil(ms / 1000))
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    countdownTimer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownTimer.current) {
            clearInterval(countdownTimer.current)
            countdownTimer.current = null
          }
          return 0
        }
        return c - 1
      })
    }, 1000)
  }

  async function handleSend(): Promise<void> {
    setSending(true)
    setError(null)
    try {
      const result = (await window.agent.bugReport.send({ description, logs })) as SendResult
      if (result.ok) {
        markSent()
        setTimeout(() => close(), 1000)
      } else if (result.error === 'rate_limited') {
        startCountdown(result.retryAfterMs)
        setError('Merci de patienter avant un nouvel envoi.')
      } else if (result.error === 'not_configured') {
        setError('Fonctionnalité désactivée en développement.')
      } else if (result.error === 'timeout') {
        setError('Délai dépassé, réessaye.')
      } else {
        setError('Impossible d’envoyer le rapport. Réessaye plus tard.')
      }
    } finally {
      setSending(false)
    }
  }

  if (!isOpen) return null

  const canSend =
    !sending && countdown === 0 && (description.trim().length > 0 || logs.trim().length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div
        className="rounded-lg shadow-xl w-full max-w-2xl flex flex-col gap-4 p-6"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Signaler un bug</h2>
          <button
            onClick={close}
            className="text-sm"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--color-text-muted)' }}>Description (optionnelle)</span>
          <textarea
            data-testid="bug-description-textarea"
            className="rounded p-2 text-sm"
            rows={3}
            placeholder="Que faisais-tu quand le bug est apparu ?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-deep)',
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center justify-between">
            <span style={{ color: 'var(--color-text-muted)' }}>Logs à envoyer (éditables)</span>
            <button
              type="button"
              onClick={() => void refreshLogs()}
              className="text-xs underline"
              style={{ color: 'var(--color-primary)' }}
            >
              Refresh logs
            </button>
          </span>
          <textarea
            data-testid="bug-logs-textarea"
            className="rounded p-2 text-xs font-mono"
            rows={10}
            value={logs}
            onChange={(e) => setLogs(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-deep)',
            }}
          />
        </label>

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Metadata auto-ajoutées : version, OS, session (X11/Wayland), backend AI, thème actif.
        </p>

        {error && (
          <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="bug-cancel-button"
            onClick={close}
            className="px-4 py-2 rounded text-sm"
            style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
          >
            Annuler
          </button>
          <button
            data-testid="bug-send-button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-contrast)' }}
          >
            {sending
              ? 'Envoi…'
              : countdown > 0
                ? `Réessaye dans ${countdown}s`
                : 'Envoyer le rapport'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/bugReport/BugReportModal.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/bugReport/BugReportModal.tsx src/renderer/components/bugReport/BugReportModal.test.tsx
git commit -m "feat(bug-report): add bug report modal UI"
```

---

## Task 11: About section entry point

**Files:**
- Modify: `src/renderer/components/settings/AboutSection.tsx`

- [ ] **Step 1: Add Report button under the System Info block**

Edit `src/renderer/components/settings/AboutSection.tsx`.

1. At the top of the file, add imports:
   ```ts
   import { useBugReportStore } from '../../stores/bugReportStore'
   ```

2. Inside the `AboutSection` function component, obtain the store opener (after the existing hooks):
   ```ts
   const openBugReport = useBugReportStore((s) => s.open)
   ```

3. Add a new section between the `{/* GitHub Link */}` block and `{/* License */}` block:
   ```tsx
         {/* Bug report */}
         <div>
           <button
             onClick={() => openBugReport()}
             className="px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 mobile:py-3"
             style={{
               backgroundColor: 'var(--color-bg)',
               color: 'var(--color-text)',
               border: '1px solid var(--color-deep)',
             }}
           >
             Signaler un bug
           </button>
         </div>
   ```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/AboutSection.tsx
git commit -m "feat(bug-report): wire About section entry point"
```

---

## Task 12: ErrorBoundary entry point

**Files:**
- Modify: `src/renderer/components/ErrorBoundary.tsx`

- [ ] **Step 1: Add the Report button to the crash screen**

Edit `src/renderer/components/ErrorBoundary.tsx`.

Replace the entire file contents with:

```tsx
import { Component, type ReactNode } from 'react'
import { useBugReportStore } from '../stores/bugReportStore'
import { rendererErrorBuffer } from '../bootstrap/rendererErrorCapture'

interface Props {
  fallback?: ReactNode
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function ReportCrashButton({ error }: { error: Error | null }): JSX.Element {
  const open = useBugReportStore((s) => s.open)
  const handleClick = (): void => {
    if (error) {
      rendererErrorBuffer.push({
        timestamp: new Date().toISOString(),
        source: 'renderer',
        level: 'error',
        message: `UI crash: ${error.message}\n${error.stack ?? ''}`,
      })
    }
    open({ prefillDescription: error ? `UI crash: ${error.message}` : '' })
  }
  return (
    <button
      onClick={handleClick}
      className="mt-2 px-4 py-2 text-xs rounded"
      style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
    >
      Signaler ce crash
    </button>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          className="flex-1 flex items-center justify-center p-6"
          style={{ color: 'var(--color-error)' }}
        >
          <div className="text-center max-w-md">
            <p className="text-sm font-medium mb-2">Something went wrong</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {this.state.error?.message}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 px-4 py-2 text-xs rounded"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              Try again
            </button>
            <div>
              <ReportCrashButton error={this.state.error} />
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ErrorBoundary.tsx
git commit -m "feat(bug-report): add Report-this-crash button to ErrorBoundary"
```

---

## Task 13: Tray menu entry point

**Files:**
- Modify: `src/main/services/tray.ts`

- [ ] **Step 1: Add a "Signaler un bug…" menu item**

Open `src/main/services/tray.ts`. Locate `buildContextMenu()` (search `function buildContextMenu`). Inside its `items` array (before the final quit entry), insert a new menu item:

```ts
    {
      label: 'Signaler un bug…',
      click: () => {
        const win = getWindowFn?.() ?? null
        if (isAlive(win)) {
          win.show()
          if (win.isMinimized()) win.restore()
          win.focus()
          win.webContents.send('bugReport:open')
        } else {
          ensureWindowFn?.()
          const w = getWindowFn?.() ?? null
          if (isAlive(w)) {
            w.once('ready-to-show', () => w.webContents.send('bugReport:open'))
            w.show()
          }
        }
      },
    },
    { type: 'separator' },
```

Place it directly above whatever existing Quit item is present, preserving surrounding items.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/tray.ts
git commit -m "feat(bug-report): add tray menu entry point"
```

---

## Task 14: Main process bootstrap wiring

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Patch console.error ASAP and load/attach persistence**

Edit `src/main/index.ts`.

1. At the very top of the file (above all other imports except `./utils/coloredConsole`), add:
   ```ts
   import { ErrorBuffer } from '../core/services/errorBuffer'
   import { patchConsoleError } from './bootstrap/mainErrorCapture'
   import { loadFromDisk, attachPersistence } from './services/errorBufferPersist'

   export const mainErrorBuffer = new ErrorBuffer()
   patchConsoleError(mainErrorBuffer)
   ```

2. Below your existing `registerPreviewScheme()` call, but before `enrichEnvironment()`, add:
   ```ts
   import { app as electronApp } from 'electron'
   import { join as pathJoin } from 'path'
   const errorBufferPath = pathJoin(electronApp.getPath('userData'), 'error-buffer.json')
   ```

   *(If `app` and `join` are already imported elsewhere in the file, reuse those imports instead of re-importing; the intent is simply to compute `errorBufferPath`.)*

3. Inside `app.whenReady().then(async () => { ... })` (or wherever the async boot runs after `enrichEnvironment()` and before the rest of the app starts), add near the top of the async body:
   ```ts
   await loadFromDisk(mainErrorBuffer, errorBufferPath)
   attachPersistence(mainErrorBuffer, errorBufferPath)
   ```

4. When constructing `CoreHandlerOptions` to pass to `registerCoreHandlers`, add the `bugReport` field:
   ```ts
   import { getSessionType } from './utils/env' // if not already imported — or construct inline

   const bugReportOptions = {
     mainBuffer: mainErrorBuffer,
     getMetadata: async () => ({
       version: electronApp.getVersion(),
       platform: `${process.platform} (${process.arch})`,
       session:
         process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY
           ? ('Wayland' as const)
           : process.env.DISPLAY
             ? ('X11' as const)
             : ('unknown' as const),
       electron: process.versions.electron ?? 'unknown',
       node: process.versions.node ?? 'unknown',
       aiBackend: 'claude-agent-sdk', // default; overridden if global settings store a value
       theme: 'default',
       webMode: process.env.AGENT_WEB_MODE ? ('yes' as const) : ('no' as const),
     }),
     getWebhookUrl: () => import.meta.env.MAIN_VITE_BUG_WEBHOOK_URL ?? '',
   }

   // pass into existing registerCoreHandlers call:
   registerCoreHandlers(engine.dispatch, db, {
     broadcaster,
     hookRunner,
     sessionsBase,
     themesDir,
     knowledgesDir,
     bugReport: bugReportOptions,
   })
   ```

   Adapt the exact call site to match the existing `registerCoreHandlers(...)` invocation in this file — only add the `bugReport` field, do not rewrite the surrounding call.

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(bug-report): wire main process — patch, persist, handler options"
```

---

## Task 15: Renderer process bootstrap wiring

**Files:**
- Modify: `src/renderer/main.tsx` (verified entry path)

- [ ] **Step 1: Patch console.error and install global handlers at the top of `main.tsx`**

Edit `src/renderer/main.tsx`. Before any other import, add:

```ts
import {
  rendererErrorBuffer,
  patchRendererConsoleError,
  installGlobalErrorHandlers,
} from './bootstrap/rendererErrorCapture'

patchRendererConsoleError(rendererErrorBuffer)
installGlobalErrorHandlers(rendererErrorBuffer)
```

- [ ] **Step 2: Mount the modal globally in the render tree**

Still in `src/renderer/main.tsx`, add the import near the other component imports:

```ts
import { BugReportModal } from './components/bugReport/BugReportModal'
```

Locate the `ReactDOM.createRoot(...).render(...)` call. Inside the JSX passed to `render(...)`, wrap the existing root element so the modal is a sibling:

```tsx
// Before:
// <App />
// After:
<>
  <App />
  <BugReportModal />
</>
```

If the root is already inside `<StrictMode>` or a provider, keep that wrapper — add the fragment *inside* the innermost wrapper so `<BugReportModal />` has the same context as `<App />`.

- [ ] **Step 3: Subscribe to tray open-request inside `<App />`**

Open `src/renderer/App.tsx` (or whichever file exports the `App` component). At the top of the component body, add:

```ts
import { useEffect } from 'react'
import { useBugReportStore } from './stores/bugReportStore'

// inside App():
useEffect(() => {
  const unsub = window.agent.bugReport.onOpenRequest(() => {
    useBugReportStore.getState().open()
  })
  return unsub
}, [])
```

If `App.tsx` already imports `useEffect`, do not re-import it. If `App` is defined as a class component, add the subscription inside `componentDidMount` / `componentWillUnmount` instead; convert to a hook only if trivial.

- [ ] **Step 4: Typecheck and run renderer tests**

Run: `npm run build`
Expected: 0 errors.

Run: `npx vitest run src/renderer`
Expected: all renderer tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat(bug-report): wire renderer bootstrap, modal mount, tray listener"
```

---

## Task 16: Gitignore `.env.production`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Check current `.gitignore`**

Run: `npx rg -n 'env\.production' .gitignore || echo "not present"`

- [ ] **Step 2: Add the entry if absent**

If the previous step printed "not present", append to `.gitignore`:

```
# Bug report webhook URL (injected at build time)
.env.production
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore(bug-report): gitignore .env.production for webhook URL"
```

---

## Task 17: Full test suite + build verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (existing 1917 tests plus new ones added in this plan).

- [ ] **Step 2: Run the TypeScript build**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: If any test fails or type error surfaces**

Fix at the source (not by removing the test). Re-run until green. Commit any fixup separately:

```bash
git commit -m "fix(bug-report): <specific thing>"
```

- [ ] **Step 4: Smoke-test in dev**

Run: `npm run dev`
Expected observations:
- Open Settings → About; click "Signaler un bug". Modal opens, logs textarea populates (likely empty since no recent errors).
- Type a description; click "Envoyer le rapport". Toast/error appears: "Fonctionnalité désactivée en développement." (env var absent in dev).
- Trigger a test error: open devtools console, run `console.error('test error from smoke test')`. Click Refresh logs in the modal — the new entry appears.

- [ ] **Step 5: Final commit if smoke test required fixes**

No commit if smoke test passed without changes.

---

## Release preparation (not part of initial merge)

Before shipping to prod:

1. Create `.env.production` in the project root (already gitignored from Task 16):
   ```
   MAIN_VITE_BUG_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
   ```

   Alternative for CI: set `MAIN_VITE_BUG_WEBHOOK_URL` as a repository secret and export it before `npm run build` in the publish workflow.

2. Build a production artifact: `npm run dist:linux`.

3. Install the resulting `.AppImage` or `.deb`, trigger a manual bug report from the About section, and verify the embed arrives on the Discord channel with all metadata fields and the scrubbed logs.

4. Only after manual verification of the end-to-end path, merge / tag the release.
