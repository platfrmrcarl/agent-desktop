# Web Server Password Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional password authentication to the LAN web server (UI settings + headless CLI), with scrypt hash storage, stateless HMAC cookies, per-IP rate limiting, and atomic session revocation.

**Architecture:** Two new modules under `src/core/auth/` (webPassword, rateLimiter). WebServer gets login gate HTTP + cookie validation at WS upgrade. Settings UI adds a password section. Headless CLI gets `--set-password` / `--clear-password`. Spec: `docs/superpowers/specs/2026-04-18-web-password-design.md`.

**Tech Stack:** TypeScript, Node `crypto` builtin (scrypt + HMAC-SHA256), sql.js, electron-vite, React, Vitest.

---

## File Structure

**New files:**
- `src/core/auth/index.ts` — barrel (public API only)
- `src/core/auth/rateLimiter.ts` — per-IP attempt tracking
- `src/core/auth/rateLimiter.test.ts`
- `src/core/auth/webPassword.ts` — hash + cookie service factory
- `src/core/auth/webPassword.test.ts`
- `src/core/handlers/webServerAuth.ts` — IPC handlers
- `src/core/handlers/webServerAuth.test.ts`
- `src/renderer/components/settings/PasswordAuthSection.tsx` — UI block
- `src/renderer/components/settings/SetPasswordModal.tsx` — modal for set/change
- `src/renderer/components/settings/PasswordAuthSection.test.tsx`

**Modified files:**
- `src/core/services/settings.ts` — add 4 new whitelist keys
- `src/core/engine.ts` — expose `webPassword` service
- `src/core/handlers/index.ts` — register webServerAuth handlers
- `src/core/services/webServer.ts` — login routes, cookie gates
- `src/preload/index.ts` — new `server.*` methods
- `src/preload/api.d.ts` — types
- `src/renderer/components/settings/WebServerSettings.tsx` — mount `PasswordAuthSection`
- `src/headless/index.ts` — `--set-password` / `--clear-password` branch
- `CLAUDE.md` — new gotchas entries

---

## Task 1: Rate limiter module (TDD)

**Files:**
- Create: `src/core/auth/rateLimiter.ts`
- Test: `src/core/auth/rateLimiter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/auth/rateLimiter.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createRateLimiter, normalizeIp } from './rateLimiter'

describe('normalizeIp', () => {
  it('strips ::ffff: prefix from IPv6-mapped IPv4', () => {
    expect(normalizeIp('::ffff:192.168.1.5')).toBe('192.168.1.5')
  })
  it('returns IPv4 unchanged', () => {
    expect(normalizeIp('192.168.1.5')).toBe('192.168.1.5')
  })
  it('returns pure IPv6 unchanged', () => {
    expect(normalizeIp('fe80::1')).toBe('fe80::1')
  })
})

describe('RateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers({ now: 1_000_000 }) })
  afterEach(() => { vi.useRealTimers() })

  it('allows first attempt', () => {
    const rl = createRateLimiter()
    expect(rl.check('1.2.3.4')).toEqual({ allowed: true })
  })

  it('allows 5 failures then bans on the 6th', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 5; i++) {
      expect(rl.check('1.2.3.4').allowed).toBe(true)
      rl.recordAttempt('1.2.3.4', false)
    }
    const r = rl.check('1.2.3.4')
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('success resets the counter', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 4; i++) rl.recordAttempt('1.2.3.4', false)
    rl.recordAttempt('1.2.3.4', true)
    for (let i = 0; i < 5; i++) {
      expect(rl.check('1.2.3.4').allowed).toBe(true)
      rl.recordAttempt('1.2.3.4', false)
    }
  })

  it('ban expires after 60s window', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(61_000)
    expect(rl.check('1.2.3.4').allowed).toBe(true)
  })

  it('long ban after 20 failures lasts 15 minutes', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 20; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(14 * 60 * 1000)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    vi.advanceTimersByTime(2 * 60 * 1000)
    expect(rl.check('1.2.3.4').allowed).toBe(true)
  })

  it('tracks IPs independently', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
    expect(rl.check('5.6.7.8').allowed).toBe(true)
  })

  it('normalizes IPv6-mapped before tracking', () => {
    const rl = createRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordAttempt('::ffff:1.2.3.4', false)
    expect(rl.check('1.2.3.4').allowed).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/auth/rateLimiter.test.ts`
Expected: FAIL — `Cannot find module './rateLimiter'` or similar.

- [ ] **Step 3: Write the implementation**

Create `src/core/auth/rateLimiter.ts`:

```ts
const SHORT_WINDOW_MS = 60_000          // 1 min
const SHORT_LIMIT = 5                   // max failures per minute
const LONG_BAN_THRESHOLD = 20           // failures within 15 min
const LONG_BAN_MS = 15 * 60 * 1000

interface IpRecord {
  failures: number
  firstFailureAt: number
  bannedUntil: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds?: number
}

export interface RateLimiter {
  check(ip: string): RateLimitResult
  recordAttempt(ip: string, success: boolean): void
}

export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

export function createRateLimiter(): RateLimiter {
  const records = new Map<string, IpRecord>()

  function prune(now: number): void {
    for (const [ip, rec] of records) {
      if (rec.bannedUntil > now) continue
      if (now - rec.firstFailureAt > LONG_BAN_MS) records.delete(ip)
    }
  }

  return {
    check(ip) {
      const key = normalizeIp(ip)
      const now = Date.now()
      prune(now)
      const rec = records.get(key)
      if (!rec) return { allowed: true }
      if (rec.bannedUntil > now) {
        return { allowed: false, retryAfterSeconds: Math.ceil((rec.bannedUntil - now) / 1000) }
      }
      return { allowed: true }
    },
    recordAttempt(ip, success) {
      const key = normalizeIp(ip)
      const now = Date.now()
      if (success) {
        records.delete(key)
        return
      }
      const existing = records.get(key)
      if (!existing) {
        records.set(key, { failures: 1, firstFailureAt: now, bannedUntil: 0 })
        return
      }
      existing.failures += 1
      if (existing.failures >= LONG_BAN_THRESHOLD) {
        existing.bannedUntil = now + LONG_BAN_MS
      } else if (existing.failures >= SHORT_LIMIT + 1) {
        existing.bannedUntil = now + SHORT_WINDOW_MS
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/auth/rateLimiter.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/rateLimiter.ts src/core/auth/rateLimiter.test.ts
git commit -m "feat(auth): add per-IP rate limiter for login attempts"
```

---

## Task 2: Web password service — hash + cookie (TDD, part 1: hash)

**Files:**
- Create: `src/core/auth/webPassword.ts`
- Test: `src/core/auth/webPassword.test.ts`

- [ ] **Step 1: Write the failing test (hash operations only)**

Create `src/core/auth/webPassword.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createWebPasswordService } from './webPassword'

function makeInMemorySettings() {
  const store = new Map<string, string>()
  return {
    set: (k: string, v: string) => { store.set(k, v) },
    get: (k: string) => store.get(k),
    delete: (k: string) => { store.delete(k) },
    getAll: () => Object.fromEntries(store),
  }
}

describe('WebPasswordService — hash operations', () => {
  let settings: ReturnType<typeof makeInMemorySettings>
  beforeEach(() => { settings = makeInMemorySettings() })

  it('isPasswordSet returns false initially', () => {
    const svc = createWebPasswordService(settings)
    expect(svc.isPasswordSet()).toBe(false)
  })

  it('setPassword persists hash and sessionSecret', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('correct horse battery staple')
    expect(settings.get('server_passwordHash')).toBeTruthy()
    expect(settings.get('server_sessionSecret')).toBeTruthy()
    expect(svc.isPasswordSet()).toBe(true)
  })

  it('setPassword rejects passwords shorter than 8 chars', async () => {
    const svc = createWebPasswordService(settings)
    await expect(svc.setPassword('short')).rejects.toThrow(/at least 8/)
  })

  it('verifyPassword returns true for the correct password', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('correct horse battery staple')
    expect(await svc.verifyPassword('correct horse battery staple')).toBe(true)
  })

  it('verifyPassword returns false for an incorrect password', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('correct horse battery staple')
    expect(await svc.verifyPassword('wrong password here')).toBe(false)
  })

  it('verifyPassword returns false when no password is set', async () => {
    const svc = createWebPasswordService(settings)
    expect(await svc.verifyPassword('anything')).toBe(false)
  })

  it('hash uses a random salt each time', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('same password value')
    const hash1 = settings.get('server_passwordHash')
    await svc.setPassword('same password value')
    const hash2 = settings.get('server_passwordHash')
    expect(hash1).not.toBe(hash2)
  })

  it('setPassword rotates sessionSecret', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('first password now')
    const secret1 = settings.get('server_sessionSecret')
    await svc.setPassword('second password now')
    const secret2 = settings.get('server_sessionSecret')
    expect(secret1).not.toBe(secret2)
  })

  it('clearPassword removes hash and secret', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('some password here')
    await svc.clearPassword()
    expect(settings.get('server_passwordHash')).toBeUndefined()
    expect(settings.get('server_sessionSecret')).toBeUndefined()
    expect(svc.isPasswordSet()).toBe(false)
  })

  it('PHC string format contains parseable params', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('password for format')
    const hash = settings.get('server_passwordHash')!
    expect(hash).toMatch(/^\$scrypt\$N=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/auth/webPassword.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service implementation (hash part only)**

Create `src/core/auth/webPassword.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16
const SESSION_SECRET_BYTES = 32
const MIN_PASSWORD_LENGTH = 8

export interface SettingsPort {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
}

export interface WebPasswordService {
  setPassword(plaintext: string): Promise<void>
  clearPassword(): Promise<void>
  verifyPassword(plaintext: string): Promise<boolean>
  isPasswordSet(): boolean
  issueCookie(rememberMe: boolean): string
  validateCookie(cookieValue: string): boolean
  getSessionDurationDays(): number
  setSessionDurationDays(days: number): void
  getRememberDurationDays(): number
  setRememberDurationDays(days: number): void
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function formatPhc(salt: Buffer, hash: Buffer): string {
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`
}

function parsePhc(phc: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const m = phc.match(/^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=_-]+)\$([A-Za-z0-9+/=_-]+)$/)
  if (!m) return null
  return {
    N: parseInt(m[1], 10),
    r: parseInt(m[2], 10),
    p: parseInt(m[3], 10),
    salt: b64urlDecode(m[4]),
    hash: b64urlDecode(m[5]),
  }
}

export function createWebPasswordService(settings: SettingsPort): WebPasswordService {
  function getDurationDays(key: string, fallback: number): number {
    const raw = settings.get(key)
    if (!raw) return fallback
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  return {
    async setPassword(plaintext: string): Promise<void> {
      if (typeof plaintext !== 'string' || plaintext.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      }
      const salt = randomBytes(SALT_BYTES)
      const hash = scryptSync(plaintext, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
      settings.set('server_passwordHash', formatPhc(salt, hash))
      settings.set('server_sessionSecret', randomBytes(SESSION_SECRET_BYTES).toString('hex'))
    },

    async clearPassword(): Promise<void> {
      settings.delete('server_passwordHash')
      settings.delete('server_sessionSecret')
    },

    async verifyPassword(plaintext: string): Promise<boolean> {
      const stored = settings.get('server_passwordHash')
      if (!stored || typeof plaintext !== 'string') return false
      const parsed = parsePhc(stored)
      if (!parsed) return false
      const candidate = scryptSync(plaintext, parsed.salt, parsed.hash.length, { N: parsed.N, r: parsed.r, p: parsed.p })
      if (candidate.length !== parsed.hash.length) return false
      return timingSafeEqual(candidate, parsed.hash)
    },

    isPasswordSet(): boolean {
      return !!settings.get('server_passwordHash')
    },

    issueCookie(_rememberMe: boolean): string {
      throw new Error('not implemented yet')
    },
    validateCookie(_cookieValue: string): boolean {
      throw new Error('not implemented yet')
    },
    getSessionDurationDays(): number { return getDurationDays('server_sessionDurationDays', 7) },
    setSessionDurationDays(days: number): void { settings.set('server_sessionDurationDays', String(days)) },
    getRememberDurationDays(): number { return getDurationDays('server_rememberDurationDays', 30) },
    setRememberDurationDays(days: number): void { settings.set('server_rememberDurationDays', String(days)) },
  }
}
```

- [ ] **Step 4: Run tests, verify hash tests pass**

Run: `npx vitest run src/core/auth/webPassword.test.ts`
Expected: PASS for all 10 hash-related tests. Cookie tests come in Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/webPassword.ts src/core/auth/webPassword.test.ts
git commit -m "feat(auth): add WebPasswordService with scrypt hash (PHC format)"
```

---

## Task 3: Cookie issue + validate (TDD, part 2)

**Files:**
- Modify: `src/core/auth/webPassword.ts` (implement `issueCookie` / `validateCookie`)
- Modify: `src/core/auth/webPassword.test.ts` (append cookie tests)

- [ ] **Step 1: Append failing cookie tests**

Append to `src/core/auth/webPassword.test.ts`:

```ts
describe('WebPasswordService — cookies', () => {
  let settings: ReturnType<typeof makeInMemorySettings>
  beforeEach(() => { settings = makeInMemorySettings() })

  it('issueCookie returns a non-empty string', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('cookie test password')
    const c = svc.issueCookie(false)
    expect(typeof c).toBe('string')
    expect(c.length).toBeGreaterThan(0)
  })

  it('validateCookie returns true for a freshly issued cookie', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('cookie test password')
    const c = svc.issueCookie(false)
    expect(svc.validateCookie(c)).toBe(true)
  })

  it('validateCookie returns false for a bit-flipped cookie', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('cookie test password')
    const c = svc.issueCookie(false)
    const tampered = c.slice(0, -1) + (c.at(-1) === 'A' ? 'B' : 'A')
    expect(svc.validateCookie(tampered)).toBe(false)
  })

  it('validateCookie returns false for garbage input', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('cookie test password')
    expect(svc.validateCookie('not-even-base64')).toBe(false)
    expect(svc.validateCookie('')).toBe(false)
  })

  it('validateCookie returns false for an expired cookie', async () => {
    vi.useFakeTimers({ now: 1_000_000_000_000 })
    try {
      const svc = createWebPasswordService(settings)
      await svc.setPassword('cookie test password')
      svc.setSessionDurationDays(1)
      const c = svc.issueCookie(false)
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000)
      expect(svc.validateCookie(c)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rememberMe=true uses rememberDurationDays', async () => {
    vi.useFakeTimers({ now: 1_000_000_000_000 })
    try {
      const svc = createWebPasswordService(settings)
      await svc.setPassword('cookie test password')
      svc.setSessionDurationDays(1)
      svc.setRememberDurationDays(30)
      const c = svc.issueCookie(true)
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000)
      expect(svc.validateCookie(c)).toBe(true)
      vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000)
      expect(svc.validateCookie(c)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cookie issued before sessionSecret rotation is invalid after rotation', async () => {
    const svc = createWebPasswordService(settings)
    await svc.setPassword('first password here')
    const c = svc.issueCookie(false)
    expect(svc.validateCookie(c)).toBe(true)
    await svc.setPassword('second password now')
    expect(svc.validateCookie(c)).toBe(false)
  })

  it('validateCookie returns false when no password is set', () => {
    const svc = createWebPasswordService(settings)
    expect(svc.validateCookie('anything.anything')).toBe(false)
  })
})
```

At the top of the file, add `import { vi } from 'vitest'` if not already present (it is — `vitest` is already imported).

- [ ] **Step 2: Run the tests — expect failures on cookie tests**

Run: `npx vitest run src/core/auth/webPassword.test.ts`
Expected: FAIL on 8 new cookie tests with "not implemented yet".

- [ ] **Step 3: Implement issueCookie + validateCookie**

In `src/core/auth/webPassword.ts`, replace the two `throw new Error('not implemented yet')` stubs with:

```ts
issueCookie(rememberMe: boolean): string {
  const secret = settings.get('server_sessionSecret')
  if (!secret) throw new Error('Cannot issue cookie: password not set')
  const days = rememberMe ? getDurationDays('server_rememberDurationDays', 30) : getDurationDays('server_sessionDurationDays', 7)
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000
  const payload = String(expiresAt)
  const mac = createHmac('sha256', Buffer.from(secret, 'hex')).update(payload).digest('hex')
  return b64urlEncode(Buffer.from(`${payload}.${mac}`, 'utf-8'))
},

validateCookie(cookieValue: string): boolean {
  const secret = settings.get('server_sessionSecret')
  if (!secret || !cookieValue) return false
  let decoded: string
  try { decoded = b64urlDecode(cookieValue).toString('utf-8') }
  catch { return false }
  const dot = decoded.indexOf('.')
  if (dot <= 0 || dot === decoded.length - 1) return false
  const payload = decoded.slice(0, dot)
  const macHex = decoded.slice(dot + 1)
  const expected = createHmac('sha256', Buffer.from(secret, 'hex')).update(payload).digest()
  let provided: Buffer
  try { provided = Buffer.from(macHex, 'hex') }
  catch { return false }
  if (provided.length !== expected.length) return false
  if (!timingSafeEqual(provided, expected)) return false
  const expiresAt = parseInt(payload, 10)
  if (!Number.isFinite(expiresAt)) return false
  return expiresAt > Date.now()
},
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run src/core/auth/webPassword.test.ts`
Expected: PASS — all 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/auth/webPassword.ts src/core/auth/webPassword.test.ts
git commit -m "feat(auth): add HMAC-signed session cookies with rotation revocation"
```

---

## Task 4: Auth barrel + settings whitelist + engine wiring

**Files:**
- Create: `src/core/auth/index.ts`
- Modify: `src/core/services/settings.ts`
- Modify: `src/core/engine.ts`

- [ ] **Step 1: Create the auth barrel**

Create `src/core/auth/index.ts`:

```ts
export { createWebPasswordService, type WebPasswordService, type SettingsPort } from './webPassword'
export { createRateLimiter, normalizeIp, type RateLimiter, type RateLimitResult } from './rateLimiter'
```

- [ ] **Step 2: Add the 4 new keys to the settings whitelist**

In `src/core/services/settings.ts`, find the `// Web server` comment and add AFTER `'server_accessMode',`:

```ts
  // Web server password auth
  'server_passwordHash',
  'server_sessionSecret',
  'server_sessionDurationDays',
  'server_rememberDurationDays',
```

- [ ] **Step 3: Expose `webPassword` on the engine**

In `src/core/engine.ts`, add imports near the other service imports:

```ts
import { createWebPasswordService, type WebPasswordService } from './auth'
```

Add the field declaration next to `_scheduler`:

```ts
  private _webPassword!: WebPasswordService
```

Add the getter next to `scheduler`:

```ts
  get webPassword(): WebPasswordService { return this._webPassword }
```

Inside `init()`, AFTER `this._scheduler = new SchedulerService(db)`, add:

```ts
    this._webPassword = createWebPasswordService({
      get: (k) => {
        const all = this._settings.getAll()
        return Object.prototype.hasOwnProperty.call(all, k) ? all[k] : undefined
      },
      set: (k, v) => this._settings.set(k, v),
      delete: (k) => { this._settings.set(k, '') },
    })
```

Note: `SettingsService` has no `delete` method — setting to empty string is semantically equivalent for our reads (`isPasswordSet` checks truthiness). If the whitelist rejects `''` we will revisit.

- [ ] **Step 4: Update whitelist to allow empty string as a delete marker**

In `src/core/services/settings.ts`, in the `set()` method, BEFORE the validateString call, add an early return for empty values to support "delete via empty":

```ts
  set(key: string, value: string): void {
    validateString(key, 'key', 200)
    if (!ALLOWED_SETTING_KEYS.has(key)) {
      throw new Error(`Unknown setting key: ${key}`)
    }
    if (value === '') {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
      return
    }
    validateString(value, 'value', 10_000)
    this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))"
    ).run(key, value)
  }
```

- [ ] **Step 5: Run the existing settings test suite to confirm no regression**

Run: `npx vitest run src/core/services/settings`
Expected: PASS — existing tests unaffected. If a test depends on empty strings being stored, adapt it.

- [ ] **Step 6: Run auth tests end-to-end**

Run: `npx vitest run src/core/auth`
Expected: PASS — 18 tests.

- [ ] **Step 7: Commit**

```bash
git add src/core/auth/index.ts src/core/services/settings.ts src/core/engine.ts
git commit -m "feat(auth): wire webPassword service into engine and settings whitelist"
```

---

## Task 5: Static login HTML page

**Files:**
- Create: `src/core/services/webServer/loginPage.ts`

- [ ] **Step 1: Create the login page template**

Create `src/core/services/webServer/loginPage.ts`:

```ts
export function renderLoginPage(options: { error?: string; retryAfter?: number }): string {
  const errorBlock = options.error
    ? `<div class="error">${escapeHtml(options.error)}${options.retryAfter ? ` (retry in ${options.retryAfter}s)` : ''}</div>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent — Login</title>
<style>
:root { color-scheme: light dark; }
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0b0b0b; color: #eee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
.card { background: #151515; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4); width: 320px; max-width: 90vw; }
h1 { margin: 0 0 1rem; font-size: 1.1rem; font-weight: 600; }
label { display: block; font-size: 0.85rem; margin: 0.5rem 0 0.25rem; }
input[type=password] { width: 100%; padding: 0.55rem; background: #0b0b0b; color: #eee; border: 1px solid #333; border-radius: 4px; font-size: 1rem; box-sizing: border-box; }
input[type=password]:focus { outline: none; border-color: #4a9eff; }
.remember { margin: 0.75rem 0; font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem; }
button { width: 100%; padding: 0.6rem; background: #4a9eff; color: white; border: 0; border-radius: 4px; font-size: 1rem; cursor: pointer; margin-top: 0.5rem; }
button:hover { background: #357ad3; }
.error { background: #3a1a1a; border: 1px solid #7a2a2a; color: #ff9b9b; padding: 0.5rem; border-radius: 4px; font-size: 0.85rem; margin-bottom: 0.75rem; }
</style>
</head>
<body>
<form class="card" method="POST" action="/login" autocomplete="on">
  <h1>Agent — sign in</h1>
  ${errorBlock}
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autofocus required autocomplete="current-password">
  <label class="remember"><input type="checkbox" name="remember" value="1"> Remember me for 30 days</label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
```

- [ ] **Step 2: Write a smoke test**

Create `src/core/services/webServer/loginPage.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderLoginPage } from './loginPage'

describe('renderLoginPage', () => {
  it('returns HTML with a password input', () => {
    const html = renderLoginPage({})
    expect(html).toContain('<input')
    expect(html).toContain('type="password"')
    expect(html).toContain('action="/login"')
    expect(html).toContain('name="remember"')
  })

  it('renders an error message when provided', () => {
    const html = renderLoginPage({ error: 'Bad password' })
    expect(html).toContain('Bad password')
  })

  it('escapes HTML in the error message', () => {
    const html = renderLoginPage({ error: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('includes retry timer when provided', () => {
    const html = renderLoginPage({ error: 'Too many attempts', retryAfter: 42 })
    expect(html).toContain('retry in 42s')
  })
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/core/services/webServer/loginPage.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 4: Commit**

```bash
git add src/core/services/webServer/
git commit -m "feat(webServer): add standalone HTML login page template"
```

---

## Task 6: Integrate login gate into webServer (HTTP routes)

**Files:**
- Modify: `src/core/services/webServer.ts`

- [ ] **Step 1: Add imports and module state**

At the top of `src/core/services/webServer.ts`, add imports after the existing `import { WebSocketServer, WebSocket } from 'ws'`:

```ts
import { createRateLimiter, type RateLimiter, type WebPasswordService } from '../auth'
import { renderLoginPage } from './webServer/loginPage'
```

In the `// ─── State ───` block, after `const authenticatedClients = new Set<WebSocket>()`, add:

```ts
let webPassword: WebPasswordService | null = null
const rateLimiter: RateLimiter = createRateLimiter()
const COOKIE_NAME = 'agent_session'
```

- [ ] **Step 2: Extend `ServerStartOptions` and store the service**

Update `ServerStartOptions`:

```ts
export interface ServerStartOptions {
  shortCode?: string
  accessMode?: 'lan' | 'all'
  sslDir?: string
  rendererDir?: string
  dispatch?: DispatchRegistry
  webPassword?: WebPasswordService
}
```

In `startServer`, after `serverDispatch = options?.dispatch ?? null`, add:

```ts
  webPassword = options?.webPassword ?? null
```

In `stopServer`, after `serverDispatch = null`, add:

```ts
  webPassword = null
```

- [ ] **Step 3: Add cookie parsing + login handler helpers**

Add these helper functions BEFORE the `requestHandler` definition inside `startServer` (they close over `port`, so keep them inline or move them out carefully — we put them at module level and pass no closures):

Add at module level, after `function safeSend(...)`:

```ts
function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

async function readRequestBody(req: http.IncomingMessage, maxBytes = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of body.split('&')) {
    if (!part) continue
    const [k, v = ''] = part.split('=')
    try { out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')) }
    catch { /* skip malformed */ }
  }
  return out
}

function cookieIsValid(req: http.IncomingMessage): boolean {
  if (!webPassword || !webPassword.isPasswordSet()) return true
  const raw = getCookieValue(req.headers.cookie, COOKIE_NAME)
  if (!raw) return false
  return webPassword.validateCookie(raw)
}

function remoteIp(req: http.IncomingMessage): string {
  return req.socket.remoteAddress || ''
}
```

- [ ] **Step 4: Modify `requestHandler` to handle login routes and gate other paths**

Inside `startServer`, replace the body of `requestHandler` with:

```ts
  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!isAllowedRemote(req.socket.remoteAddress)) {
      res.writeHead(403)
      res.end('Forbidden: LAN access only')
      return
    }

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = new URL(req.url || '/', `http://localhost:${port}`)
    const passwordSet = !!webPassword && webPassword.isPasswordSet()

    // Static shim is public (no content secret: the token is injected only on authenticated routes)
    if (url.pathname === '/agent-ws-shim.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
      res.end(shimScript)
      return
    }

    // POST /login
    if (url.pathname === '/login' && req.method === 'POST') {
      const ip = remoteIp(req)
      const rl = rateLimiter.check(ip)
      if (!rl.allowed) {
        res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': String(rl.retryAfterSeconds ?? 60) })
        res.end(renderLoginPage({ error: 'Too many attempts', retryAfter: rl.retryAfterSeconds }))
        return
      }
      let body = ''
      try { body = await readRequestBody(req) } catch { res.writeHead(413); res.end(); return }
      const form = parseFormBody(body)
      const ok = webPassword ? await webPassword.verifyPassword(form.password || '') : false
      rateLimiter.recordAttempt(ip, ok)
      if (!ok) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(renderLoginPage({ error: 'Invalid password' }))
        return
      }
      const cookie = webPassword!.issueCookie(form.remember === '1')
      const days = form.remember === '1' ? webPassword!.getRememberDurationDays() : webPassword!.getSessionDurationDays()
      const maxAge = days * 24 * 60 * 60
      const secureFlag = serverProtocol === 'https' ? ' Secure;' : ''
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE_NAME}=${cookie}; HttpOnly;${secureFlag} SameSite=Strict; Path=/; Max-Age=${maxAge}`,
        Location: serverShortCode ? `/s/${serverShortCode}` : '/',
      })
      res.end()
      return
    }

    // POST /logout
    if (url.pathname === '/logout' && req.method === 'POST') {
      res.writeHead(302, {
        'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
        Location: '/login',
      })
      res.end()
      return
    }

    // GET /login
    if (url.pathname === '/login') {
      res.writeHead(passwordSet ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(passwordSet ? renderLoginPage({}) : 'Not found')
      return
    }

    // Gate everything else behind cookie when password is set
    if (passwordSet && !cookieIsValid(req)) {
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }

    const shortMatch = url.pathname.match(/^\/s\/([a-zA-Z0-9]+)$/)
    if (shortMatch) {
      if (shortMatch[1] !== serverShortCode) {
        res.writeHead(403); res.end('Invalid short code'); return
      }
      // When password is set, cookie auth is primary — skip token injection.
      const tokenScript = passwordSet ? '' : `<script>window.__AGENT_TOKEN__=${JSON.stringify(serverToken)};</script>`
      if (devUrl) proxyToDevWithTokenInjection(devUrl, req, res, shimScript, tokenScript)
      else serveStaticFileWithTokenInjection('/', res, shimScript, tokenScript)
      return
    }

    if (devUrl) proxyToDev(devUrl, url.pathname, req, res, shimScript)
    else serveStaticFile(url.pathname, res, shimScript)
  }
```

- [ ] **Step 5: Modify `upgradeHandler` to enforce cookie when password set**

Inside `startServer`, replace the body of `upgradeHandler`:

```ts
  const upgradeHandler = (req: http.IncomingMessage, socket: import('stream').Duplex, head: Buffer) => {
    if (!isAllowedRemote(req.socket.remoteAddress)) { socket.destroy(); return }

    const passwordSet = !!webPassword && webPassword.isPasswordSet()
    if (passwordSet && !cookieIsValid(req)) { socket.destroy(); return }

    const url = new URL(req.url || '/', `http://localhost:${port}`)
    if (url.pathname === '/ws') {
      wss!.handleUpgrade(req, socket, head, (wsClient) => {
        if (passwordSet) {
          // Cookie already validated — pre-authenticate
          authenticatedClients.add(wsClient)
        }
        wss!.emit('connection', wsClient, req)
      })
    } else if (devUrl) {
      // ... keep the existing dev-server proxy branch unchanged ...
      const target = new URL(devUrl)
      const proxyReq = http.request({
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        headers: req.headers,
        method: req.method,
      })
      proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
        let response = 'HTTP/1.1 101 Switching Protocols\r\n'
        for (let i = 0; i < _proxyRes.rawHeaders.length; i += 2) {
          response += _proxyRes.rawHeaders[i] + ': ' + _proxyRes.rawHeaders[i + 1] + '\r\n'
        }
        response += '\r\n'
        socket.write(response)
        if (proxyHead.length) socket.write(proxyHead)
        if (head.length) proxySocket.write(head)
        proxySocket.pipe(socket)
        socket.pipe(proxySocket)
        socket.on('error', () => proxySocket.destroy())
        proxySocket.on('error', () => socket.destroy())
      })
      proxyReq.on('error', () => socket.destroy())
      proxyReq.end()
    } else {
      socket.destroy()
    }
  }
```

In the `wss.on('connection', ...)` block, the cookie-authenticated clients are already pre-added. When `handleWsMessage` sees a `type: 'auth'` message from a pre-authenticated client, it should skip the check (already set). Update the `handleWsMessage` function — find the `if (msg.type === 'auth')` block and replace with:

```ts
  if (msg.type === 'auth') {
    if (authenticatedClients.has(ws)) {
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: true }))
      return
    }
    if (msg.token === serverToken) {
      authenticatedClients.add(ws)
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: true }))
    } else {
      safeSend(ws, JSON.stringify({ type: 'auth_result', success: false, error: 'Invalid token' }))
    }
    return
  }
```

- [ ] **Step 6: Verify the project still compiles**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test -- webServer`
Expected: PASS. If an existing test breaks because `webPassword` is null (default), verify the `passwordSet` branch gates correctly — null service means password not set means no behavior change.

- [ ] **Step 8: Commit**

```bash
git add src/core/services/webServer.ts
git commit -m "feat(webServer): add login gate, cookie auth, WS upgrade cookie check"
```

---

## Task 7: Pass `webPassword` from headless index + Electron to the server

**Files:**
- Modify: `src/headless/index.ts`
- Modify: `src/main/index.ts` (or wherever `startServer` is currently called from Electron)

- [ ] **Step 1: Find the Electron call site**

Run: `npx rg "startServer\(" src/main/ -n`
Expected: one or two hits, likely in `src/main/services/webServer.ts` (re-export) and one `.start` IPC handler call.

- [ ] **Step 2: Update the headless call site**

In `src/headless/index.ts`, find the `startServer(serverPort, { ... })` call (around line 119) and add `webPassword: engine.webPassword` to the options object:

```ts
    const result = await startServer(serverPort, {
      sslDir,
      rendererDir,
      dispatch,
      shortCode: serverShortCode,
      accessMode: serverAccessMode,
      webPassword: engine.webPassword,
    })
```

- [ ] **Step 3: Update the Electron call site**

In the Electron main process file where `startServer` is invoked via the `server:start` handler (the existing `registerHandlers` in `webServer.ts` accepts options from the IPC caller), we need to pass `engine.webPassword` into the options. Locate how the IPC `server:start` handler accesses the engine.

Find in `src/main/index.ts` (or the equivalent bootstrap file) where `registerHandlers(ipcMain, db)` or a similar call is made, and where the engine is held. Modify the `server:start` handler in `src/core/services/webServer.ts` lines 1065–1069 to accept the service from the registrar via a closure:

Replace the existing `registerHandlers` export in `src/core/services/webServer.ts`:

```ts
export interface WebServerHandlerOptions {
  webPassword?: WebPasswordService
}

export function registerHandlers(
  registrar: HandleRegistrar,
  options?: WebServerHandlerOptions,
): void {
  registrar.handle('server:start', async (_event, port?: unknown, userOptions?: unknown) => {
    const p = typeof port === 'number' && port > 0 ? port : 3484
    const merged = { ...(userOptions as ServerStartOptions), webPassword: options?.webPassword } as ServerStartOptions
    return startServer(p, merged)
  })

  registrar.handle('server:stop', async () => { await stopServer() })
  registrar.handle('server:getStatus', async () => getServerStatus())
}
```

- [ ] **Step 4: Update the Electron caller to pass the engine's webPassword**

Find where `registerHandlers` (from `webServer.ts`) is called in the main process. Run:

```
npx rg "registerHandlers\(" src/main/ -n
```

Update that call to pass `{ webPassword: engine.webPassword }`. The exact path depends on the current main bootstrap — it's likely `src/main/index.ts`. Example change:

```ts
registerHandlers(ipcMain, { webPassword: engine.webPassword })
```

- [ ] **Step 5: Run build and tests**

```
npm run build && npm test -- webServer
```

Expected: 0 errors, tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/headless/index.ts src/core/services/webServer.ts src/main/
git commit -m "feat(webServer): plumb webPassword from engine into server options"
```

---

## Task 8: IPC handlers for password operations

**Files:**
- Create: `src/core/handlers/webServerAuth.ts`
- Create: `src/core/handlers/webServerAuth.test.ts`
- Modify: `src/core/handlers/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/handlers/webServerAuth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerWebServerAuthHandlers } from './webServerAuth'
import { createWebPasswordService } from '../auth'

function memSettings() {
  const s = new Map<string, string>()
  return {
    set: (k: string, v: string) => { v === '' ? s.delete(k) : s.set(k, v) },
    get: (k: string) => s.get(k),
    delete: (k: string) => { s.delete(k) },
    getAll: () => Object.fromEntries(s),
  }
}

describe('webServerAuth handlers', () => {
  let dispatch: DispatchRegistry
  let svc: ReturnType<typeof createWebPasswordService>

  beforeEach(() => {
    dispatch = new DispatchRegistry()
    svc = createWebPasswordService(memSettings())
    registerWebServerAuthHandlers(dispatch, svc)
  })

  it('registers all five channels', () => {
    expect(dispatch.has('server:setPassword')).toBe(true)
    expect(dispatch.has('server:clearPassword')).toBe(true)
    expect(dispatch.has('server:isPasswordSet')).toBe(true)
    expect(dispatch.has('server:getSessionDurationDays')).toBe(true)
    expect(dispatch.has('server:setSessionDurationDays')).toBe(true)
    expect(dispatch.has('server:getRememberDurationDays')).toBe(true)
    expect(dispatch.has('server:setRememberDurationDays')).toBe(true)
  })

  it('setPassword then isPasswordSet returns true', async () => {
    await dispatch.get('server:setPassword')!('hello world password')
    const r = await dispatch.get('server:isPasswordSet')!()
    expect(r).toBe(true)
  })

  it('clearPassword disables the password', async () => {
    await dispatch.get('server:setPassword')!('hello world password')
    await dispatch.get('server:clearPassword')!()
    const r = await dispatch.get('server:isPasswordSet')!()
    expect(r).toBe(false)
  })

  it('session duration roundtrip', async () => {
    await dispatch.get('server:setSessionDurationDays')!(14)
    const r = await dispatch.get('server:getSessionDurationDays')!()
    expect(r).toBe(14)
  })

  it('setPassword rejects short passwords with a useful error', async () => {
    await expect(dispatch.get('server:setPassword')!('short')).rejects.toThrow(/at least 8/)
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npx vitest run src/core/handlers/webServerAuth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handlers**

Create `src/core/handlers/webServerAuth.ts`:

```ts
import type { HandleRegistrar } from '../dispatch'
import type { WebPasswordService } from '../auth'

export function registerWebServerAuthHandlers(
  registrar: HandleRegistrar,
  service: WebPasswordService,
): void {
  registrar.handle('server:setPassword', async (_event, plaintext: unknown) => {
    if (typeof plaintext !== 'string') throw new Error('password must be a string')
    await service.setPassword(plaintext)
  })

  registrar.handle('server:clearPassword', async () => {
    await service.clearPassword()
  })

  registrar.handle('server:isPasswordSet', async () => service.isPasswordSet())

  registrar.handle('server:getSessionDurationDays', async () => service.getSessionDurationDays())

  registrar.handle('server:setSessionDurationDays', async (_event, days: unknown) => {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) throw new Error('days must be a positive number')
    service.setSessionDurationDays(Math.floor(days))
  })

  registrar.handle('server:getRememberDurationDays', async () => service.getRememberDurationDays())

  registrar.handle('server:setRememberDurationDays', async (_event, days: unknown) => {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) throw new Error('days must be a positive number')
    service.setRememberDurationDays(Math.floor(days))
  })
}
```

- [ ] **Step 4: Register via `registerCoreHandlers`**

In `src/core/handlers/index.ts`, add to the imports:

```ts
import { registerWebServerAuthHandlers } from './webServerAuth'
```

Add a new field to `CoreHandlerOptions`:

```ts
export interface CoreHandlerOptions {
  // ... existing fields ...
  webPassword: import('../auth').WebPasswordService
}
```

Add the call at the end of `registerCoreHandlers`:

```ts
  registerWebServerAuthHandlers(registrar, options.webPassword)
```

In `src/core/engine.ts`, update the `registerCoreHandlers` call inside `init()` to pass `webPassword: this._webPassword`:

```ts
    registerCoreHandlers(this.dispatch, db, {
      broadcaster: this.broadcaster,
      hookRunner: this.hookRunner,
      sessionsBase: join(homedir(), '.agent-desktop', 'sessions-folder'),
      themesDir: this.themesDir,
      knowledgesDir: join(homedir(), '.agent-desktop', 'knowledges'),
      webPassword: this._webPassword,
    })
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/core/handlers/webServerAuth.test.ts && npm run build`
Expected: PASS + 0 build errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/handlers/
git commit -m "feat(ipc): add webServerAuth handlers for password operations"
```

---

## Task 9: Preload API

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: Extend the `server:` block in preload**

In `src/preload/index.ts`, find the `server: { ... }` block (around line 233) and replace it with:

```ts
  server: {
    start: (port?: number, options?: { shortCode?: string; accessMode?: string }) => withTimeout(ipcRenderer.invoke('server:start', port, options)),
    stop: () => withTimeout(ipcRenderer.invoke('server:stop')),
    getStatus: () => withTimeout(ipcRenderer.invoke('server:getStatus')),
    setPassword: (plaintext: string) => withTimeout(ipcRenderer.invoke('server:setPassword', plaintext)),
    clearPassword: () => withTimeout(ipcRenderer.invoke('server:clearPassword')),
    isPasswordSet: () => withTimeout(ipcRenderer.invoke('server:isPasswordSet')),
    getSessionDurationDays: () => withTimeout(ipcRenderer.invoke('server:getSessionDurationDays')),
    setSessionDurationDays: (days: number) => withTimeout(ipcRenderer.invoke('server:setSessionDurationDays', days)),
    getRememberDurationDays: () => withTimeout(ipcRenderer.invoke('server:getRememberDurationDays')),
    setRememberDurationDays: (days: number) => withTimeout(ipcRenderer.invoke('server:setRememberDurationDays', days)),
  },
```

- [ ] **Step 2: Extend `api.d.ts`**

In `src/preload/api.d.ts`, replace the `server: { ... }` interface block with:

```ts
  server: {
    start(port?: number, options?: { shortCode?: string; accessMode?: string }): Promise<{ url: string; token: string }>
    stop(): Promise<void>
    getStatus(): Promise<{ running: boolean; port: number | null; url: string | null; urlHostname: string | null; lanIp: string | null; hostname: string | null; token: string | null; shortCode: string | null; accessMode: string | null; clients: number; firewallWarning: string | null }>
    setPassword(plaintext: string): Promise<void>
    clearPassword(): Promise<void>
    isPasswordSet(): Promise<boolean>
    getSessionDurationDays(): Promise<number>
    setSessionDurationDays(days: number): Promise<void>
    getRememberDurationDays(): Promise<number>
    setRememberDurationDays(days: number): Promise<void>
  }
```

- [ ] **Step 3: Update the web shim (in `webServer.ts`)**

In `src/core/services/webServer.ts`, find the `window.agent.server = { ... }` inside `generateShim`. Replace with:

```js
    server: {
      start: noopAsync,
      stop: noopAsync,
      getStatus: function() { return Promise.resolve({ running: false, port: null, url: null, urlHostname: null, lanIp: null, hostname: null, token: null, shortCode: null, accessMode: null, clients: 0, firewallWarning: null }); },
      setPassword: function(p) { return invoke('server:setPassword', [p]); },
      clearPassword: function() { return invoke('server:clearPassword', []); },
      isPasswordSet: function() { return invoke('server:isPasswordSet', []); },
      getSessionDurationDays: function() { return invoke('server:getSessionDurationDays', []); },
      setSessionDurationDays: function(d) { return invoke('server:setSessionDurationDays', [d]); },
      getRememberDurationDays: function() { return invoke('server:getRememberDurationDays', []); },
      setRememberDurationDays: function(d) { return invoke('server:setRememberDurationDays', [d]); },
    },
```

Note: the WebSocket route blocker currently rejects any `msg.channel.startsWith('server:')`. Relax this — the blocker's purpose is preventing web clients from controlling server lifecycle (`start`/`stop`/`getStatus`), NOT preventing password management. Find the block:

```ts
    if (msg.channel.startsWith('server:') || msg.channel === 'openscad:exportStl') {
```

Replace with an explicit list:

```ts
    if (msg.channel === 'server:start' || msg.channel === 'server:stop' || msg.channel === 'server:getStatus' || msg.channel === 'openscad:exportStl') {
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/ src/core/services/webServer.ts
git commit -m "feat(preload): expose server.password* methods to renderer and web shim"
```

---

## Task 10: Settings UI — password section + modal

**Files:**
- Create: `src/renderer/components/settings/PasswordAuthSection.tsx`
- Create: `src/renderer/components/settings/SetPasswordModal.tsx`
- Create: `src/renderer/components/settings/PasswordAuthSection.test.tsx`
- Modify: `src/renderer/components/settings/WebServerSettings.tsx`

- [ ] **Step 1: Write the component test**

Create `src/renderer/components/settings/PasswordAuthSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PasswordAuthSection } from './PasswordAuthSection'

function installMockAgent(isSet = false) {
  const api = {
    isPasswordSet: vi.fn(async () => isSet),
    setPassword: vi.fn(async () => {}),
    clearPassword: vi.fn(async () => {}),
    getSessionDurationDays: vi.fn(async () => 7),
    setSessionDurationDays: vi.fn(async () => {}),
    getRememberDurationDays: vi.fn(async () => 30),
    setRememberDurationDays: vi.fn(async () => {}),
  }
  ;(window as any).agent = { server: api }
  return api
}

describe('PasswordAuthSection', () => {
  beforeEach(() => { installMockAgent(false) })

  it('renders Disabled when no password is set', async () => {
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByText(/Password authentication/i)).toBeInTheDocument())
    expect(screen.getByText(/Disabled/i)).toBeInTheDocument()
  })

  it('shows Set password button when disabled', async () => {
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Set password/i })).toBeInTheDocument())
  })

  it('shows warning when accessMode=all and no password', async () => {
    render(<PasswordAuthSection accessMode="all" />)
    await waitFor(() => expect(screen.getByText(/Internet access enabled without a password/i)).toBeInTheDocument())
  })

  it('shows Change/Disable buttons when password is set', async () => {
    installMockAgent(true)
    render(<PasswordAuthSection accessMode="lan" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Change password/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Disable/i })).toBeInTheDocument()
  })

  it('clicking Disable calls clearPassword', async () => {
    const api = installMockAgent(true)
    window.confirm = vi.fn(() => true)
    render(<PasswordAuthSection accessMode="lan" />)
    const btn = await screen.findByRole('button', { name: /Disable/i })
    fireEvent.click(btn)
    await waitFor(() => expect(api.clearPassword).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run it to verify fail**

Run: `npx vitest run src/renderer/components/settings/PasswordAuthSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the modal component**

Create `src/renderer/components/settings/SetPasswordModal.tsx`:

```tsx
import { useState } from 'react'

export function SetPasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
    if (pwd.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (pwd !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await window.agent.server.setPassword(pwd)
      onSaved()
    } catch (err) {
      setError((err as Error).message || 'Failed to save password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="p-6 rounded-lg w-full max-w-sm space-y-3"
        style={{ background: 'var(--color-base)', color: 'var(--color-body)' }}
      >
        <h2 className="text-base font-semibold">Set web server password</h2>
        <label className="block text-sm">
          New password
          <input type="password" autoFocus required value={pwd} onChange={(e) => setPwd(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border" style={{ background: 'var(--color-base)', borderColor: 'var(--color-muted)' }} />
        </label>
        <label className="block text-sm">
          Confirm password
          <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full mt-1 px-2 py-1 rounded border" style={{ background: 'var(--color-base)', borderColor: 'var(--color-muted)' }} />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1 rounded border" style={{ borderColor: 'var(--color-muted)' }}>Cancel</button>
          <button type="submit" disabled={busy} className="px-3 py-1 rounded" style={{ background: 'var(--color-primary)', color: 'white' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Create the section component**

Create `src/renderer/components/settings/PasswordAuthSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { SetPasswordModal } from './SetPasswordModal'

export function PasswordAuthSection({ accessMode }: { accessMode: 'lan' | 'all' }) {
  const [isSet, setIsSet] = useState<boolean | null>(null)
  const [sessionDays, setSessionDays] = useState(7)
  const [rememberDays, setRememberDays] = useState(30)
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [set, s, r] = await Promise.all([
        window.agent.server.isPasswordSet(),
        window.agent.server.getSessionDurationDays(),
        window.agent.server.getRememberDurationDays(),
      ])
      setIsSet(set)
      setSessionDays(s)
      setRememberDays(r)
    } catch {
      setIsSet(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function handleDisable(): Promise<void> {
    if (!window.confirm('Disable password authentication? All active sessions will be logged out.')) return
    await window.agent.server.clearPassword()
    await refresh()
  }

  async function commitSessionDays(v: number): Promise<void> {
    if (v < 1) return
    await window.agent.server.setSessionDurationDays(v)
    setSessionDays(v)
  }

  async function commitRememberDays(v: number): Promise<void> {
    if (v < 1) return
    await window.agent.server.setRememberDurationDays(v)
    setRememberDays(v)
  }

  if (isSet === null) return null

  return (
    <div className="mt-4 p-3 rounded border" style={{ borderColor: 'var(--color-muted)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Password authentication</h3>
        <span className="text-xs" style={{ color: isSet ? 'var(--color-primary)' : 'var(--color-muted)' }}>
          {isSet ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {!isSet && accessMode === 'all' && (
        <div className="mb-3 p-2 text-xs rounded" style={{ background: 'color-mix(in srgb, red 15%, transparent)', color: 'var(--color-body)' }}>
          ⚠ Internet access enabled without a password. Enable a password to protect your data.
        </div>
      )}

      {isSet ? (
        <>
          <div className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Password is set.</div>
          <div className="flex items-center gap-3 mb-2 text-xs">
            <label className="flex items-center gap-2">Session (days)
              <input type="number" min={1} value={sessionDays} onChange={(e) => commitSessionDays(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-1 py-0.5 rounded border" style={{ borderColor: 'var(--color-muted)', background: 'var(--color-base)' }} />
            </label>
            <label className="flex items-center gap-2">Remember me (days)
              <input type="number" min={1} value={rememberDays} onChange={(e) => commitRememberDays(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-1 py-0.5 rounded border" style={{ borderColor: 'var(--color-muted)', background: 'var(--color-base)' }} />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModalOpen(true)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-muted)' }}>Change password</button>
            <button onClick={handleDisable} className="text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--color-muted)', color: 'var(--color-danger, red)' }}>Disable</button>
          </div>
        </>
      ) : (
        <button onClick={() => setModalOpen(true)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-primary)', color: 'white' }}>Set password</button>
      )}

      {modalOpen && <SetPasswordModal onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); refresh() }} />}
    </div>
  )
}
```

- [ ] **Step 5: Mount the section inside WebServerSettings**

In `src/renderer/components/settings/WebServerSettings.tsx`, add the import:

```ts
import { PasswordAuthSection } from './PasswordAuthSection'
```

Then mount it inside the rendered JSX, after the access-mode selector and before the closing tag of the main container. Use the local `accessMode` state variable as the prop:

```tsx
<PasswordAuthSection accessMode={accessMode} />
```

Place this line just above the `</div>` that closes the settings card (around the QR code section — check the existing structure and place it sensibly; the exact location is wherever the config block ends).

- [ ] **Step 6: Run renderer tests**

Run: `npx vitest run src/renderer/components/settings/PasswordAuthSection.test.tsx`
Expected: PASS — 5 tests.

Also: `npm run build`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/
git commit -m "feat(ui): add password authentication section in Web Server settings"
```

---

## Task 11: Headless CLI — `--set-password` / `--clear-password`

**Files:**
- Modify: `src/headless/index.ts`
- Create: `src/headless/passwordPrompt.ts`
- Create: `src/headless/passwordPrompt.test.ts`

- [ ] **Step 1: Extract the prompt logic into a tested helper**

Create `src/headless/passwordPrompt.ts`:

```ts
import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

interface PromptOptions {
  prompt: string
  stdin: Readable
  stdout: Writable
}

export function promptMasked(opts: PromptOptions): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: opts.stdin, output: opts.stdout, terminal: true })
    const stdout = opts.stdout as Writable & { write: (s: string) => boolean }
    let entered = ''

    const onKey = (s: string): void => { /* echo masked */
      if (s === '\r' || s === '\n') return
      entered += s
      stdout.write('*')
    }

    ;(opts.stdin as unknown as { on: Function }).on('data', onKey)
    stdout.write(opts.prompt)
    rl.on('line', (line) => {
      ;(opts.stdin as unknown as { off: Function }).off('data', onKey)
      rl.close()
      stdout.write('\n')
      resolve(entered || line)
      entered = ''
    })
  })
}

export function validatePair(a: string, b: string): string | null {
  if (a.length < 8) return 'Password must be at least 8 characters.'
  if (a !== b) return 'Passwords do not match.'
  return null
}
```

- [ ] **Step 2: Test `validatePair`**

Create `src/headless/passwordPrompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validatePair } from './passwordPrompt'

describe('validatePair', () => {
  it('rejects when a is shorter than 8', () => {
    expect(validatePair('short', 'short')).toMatch(/at least 8/)
  })
  it('rejects when b does not match', () => {
    expect(validatePair('longenough', 'different!')).toMatch(/do not match/)
  })
  it('accepts when both match and are long enough', () => {
    expect(validatePair('longenough', 'longenough')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/headless/passwordPrompt.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 4: Wire the CLI flags into `src/headless/index.ts`**

In `src/headless/index.ts`, extend the `flags` object:

```ts
const flags = {
  server: args.includes('--server'),
  discord: args.includes('--discord'),
  tick: args.includes('--tick'),
  runTask: args.includes('--run-task'),
  setPassword: args.includes('--set-password'),
  clearPassword: args.includes('--clear-password'),
  port: getArgValue(args, '--port'),
  accessMode: getArgValue(args, '--access-mode') as 'lan' | 'all' | undefined,
}
```

Update `isOneShot`:

```ts
const isOneShot = flags.tick || flags.runTask || flags.setPassword || flags.clearPassword
```

Update the CLI dispatch branches at the bottom:

```ts
if (isLongRunning) {
  runServices().catch(fatal)
} else if (flags.setPassword || flags.clearPassword) {
  runPasswordMode().catch(fatal)
} else if (isOneShot) {
  import('./taskRunner').then(({ main }) => main(args)).catch(fatal)
} else {
  runInteractive().catch(fatal)
}
```

Add the new function `runPasswordMode` (place it after `runServices`):

```ts
async function runPasswordMode(): Promise<void> {
  const dbPath = process.env.AGENT_DB_PATH || DEFAULT_DB_PATH
  const themesDir = process.env.AGENT_THEMES_DIR || DEFAULT_THEMES_DIR

  const engine = new AgentEngine({
    dbPath: resolve(dbPath),
    themesDir: resolve(themesDir),
    broadcaster: { broadcast: () => {} },
    hookRunner: noopHookRunner,
    platformIO: noopPlatformIO,
    systemUI: noopSystemUI,
  })
  await engine.init()

  try {
    if (flags.clearPassword) {
      await engine.webPassword.clearPassword()
      console.log('Password cleared. Server reverted to token-based authentication.')
    } else {
      if (!process.stdin.isTTY) {
        console.error('--set-password requires a TTY (interactive terminal).')
        process.exit(1)
      }
      const { promptMasked, validatePair } = await import('./passwordPrompt')
      const pwd = await promptMasked({ prompt: 'New password: ', stdin: process.stdin, stdout: process.stdout })
      const confirm = await promptMasked({ prompt: 'Confirm: ', stdin: process.stdin, stdout: process.stdout })
      const err = validatePair(pwd, confirm)
      if (err) { console.error(err); process.exit(1) }
      await engine.webPassword.setPassword(pwd)
      console.log('Password set. Existing sessions invalidated.')
    }
  } finally {
    await engine.shutdown()
  }
}
```

- [ ] **Step 5: Build and smoke-test**

Run: `npm run build:headless`
Expected: 0 errors.

Manual smoke test (do not automate):

```bash
node out/headless/index.js --set-password
# Interactive prompt, type a 8+ char password twice
node out/headless/index.js --set-password
# Enter a short password → should error out
node out/headless/index.js --clear-password
# Should print "Password cleared..."
```

- [ ] **Step 6: Commit**

```bash
git add src/headless/
git commit -m "feat(headless): add --set-password and --clear-password CLI flags"
```

---

## Task 12: Integration test — login round-trip

**Files:**
- Modify: `src/main/services/webServer.test.ts`

- [ ] **Step 1: Append integration tests**

Append to `src/main/services/webServer.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as http from 'http'
import { startServer, stopServer } from '../../core/services/webServer'
import { createWebPasswordService } from '../../core/auth'
import { DispatchRegistry } from '../../core/dispatch'

function memSettings() {
  const s = new Map<string, string>()
  return {
    set: (k: string, v: string) => { v === '' ? s.delete(k) : s.set(k, v) },
    get: (k: string) => s.get(k),
    delete: (k: string) => { s.delete(k) },
    getAll: () => Object.fromEntries(s),
  }
}

function httpFetch(port: number, options: http.RequestOptions & { body?: string }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, ...options }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }))
    })
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

describe('webServer login gate', () => {
  const port = 38484
  let webPassword: ReturnType<typeof createWebPasswordService>

  beforeEach(async () => {
    webPassword = createWebPasswordService(memSettings())
    await webPassword.setPassword('integration test pw')
    const dispatch = new DispatchRegistry()
    await startServer(port, {
      dispatch,
      webPassword,
      shortCode: 'testshort',
      sslDir: '/tmp/does-not-exist', // forces HTTP fallback
      rendererDir: __dirname,         // any dir; we test redirects and /login
    })
  })

  afterEach(async () => { await stopServer() })

  it('redirects to /login when no cookie is present', async () => {
    const r = await httpFetch(port, { method: 'GET', path: '/' })
    expect(r.status).toBe(302)
    expect(r.headers.location).toBe('/login')
  })

  it('GET /login returns the login page', async () => {
    const r = await httpFetch(port, { method: 'GET', path: '/login' })
    expect(r.status).toBe(200)
    expect(r.body).toContain('type="password"')
  })

  it('POST /login with wrong password returns 401', async () => {
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    })
    expect(r.status).toBe(401)
  })

  it('POST /login with correct password sets cookie and redirects', async () => {
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=integration%20test%20pw',
    })
    expect(r.status).toBe(302)
    expect(r.headers['set-cookie']?.[0]).toMatch(/agent_session=/)
  })

  it('POST /login 6 times triggers rate limit 429', async () => {
    for (let i = 0; i < 5; i++) {
      await httpFetch(port, {
        method: 'POST', path: '/login',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'password=wrong',
      })
    }
    const r = await httpFetch(port, {
      method: 'POST', path: '/login',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'password=wrong',
    })
    expect(r.status).toBe(429)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/main/services/webServer.test.ts`
Expected: PASS for all the new `describe('webServer login gate', ...)` tests. Existing tests should continue to pass.

If the existing tests use the same port, bump `port` in the new suite to something unique (e.g. 38484 as used above — adjust if the file already uses it).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/webServer.test.ts
git commit -m "test(webServer): integration tests for login gate and rate limit"
```

---

## Task 13: Documentation update (CLAUDE.md gotchas)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add new gotchas**

In `CLAUDE.md`, under `## AI, MCP & Streaming Gotchas` find a reasonable section (or create a new `## Web Server Auth Gotchas`) and add:

```markdown
## Web Server Auth Gotchas
- **Password opt-in**: `server_passwordHash` null = current behavior (URL token). Non-null = HTML login gate + cookie; WS cookie-authed at upgrade, no `{type:'auth'}` needed.
- **Session revocation**: changing/clearing password rotates `server_sessionSecret` → all HMAC cookies invalidated (stateless).
- **HTTP fallback + password**: cookies travel clear-text when OpenSSL unavailable. Warn the user; still works.
- **Rate limit normalization**: `::ffff:` IPv6-mapped stripped (same as `isAllowedRemote`) or an attacker doubles the quota.
- **Cookie validation MUST precede argon2id/scrypt verify**: rate limit check runs first, before the expensive scrypt call.
- **Settings `set(key, '')`**: deletes the row (new behavior). Required for clearPassword to roundtrip.
```

Under `## Conventions & Cascade` add to the cascade notes:

```markdown
- **NOT cascaded** (global only): `server_passwordHash`, `server_sessionSecret`, `server_sessionDurationDays`, `server_rememberDurationDays`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): web server password auth gotchas"
```

---

## Task 14: Manual verification checklist

No code changes — this is a manual QA pass before declaring the feature done.

- [ ] **Step 1: Electron end-to-end**

1. `npm run dev`
2. Open Settings > Web Server.
3. Verify "Password authentication" block shows `Disabled` + Set password button.
4. Click Set password, enter `integrationtest`, confirm. Save.
5. Verify block flips to `Enabled`, Change/Disable buttons visible.
6. Click "Start server" (or use existing toggle).
7. In a private browser window on the same machine, open the short URL `/s/<shortCode>`.
8. Expect redirect to `/login`. Enter the password. Verify SPA loads.
9. Close browser, reopen URL — verify no re-prompt (cookie persists).
10. Change password in settings to a new value. Reload the browser tab — expect redirect to `/login` (old cookie invalidated).
11. Click Disable in settings (confirm). Reload browser — expect SPA loads without login.

- [ ] **Step 2: Headless CLI**

1. `npm run build:headless`
2. `node out/headless/index.js --set-password` — enter 8+ char password twice.
3. `node out/headless/index.js --server --port 3485`
4. Open `http://localhost:3485/s/<shortCode>` (shortCode is printed at startup).
5. Verify redirect to `/login`, password works, SPA loads.
6. `node out/headless/index.js --clear-password` after stopping the server — verify output.

- [ ] **Step 3: Rate limit smoke**

Via any HTTP client, POST `/login` with wrong password 6 times in under a minute. Expect the 6th to return `429` with `Retry-After` header.

- [ ] **Step 4: No regressions when password is NOT set**

1. Fresh DB (or `--clear-password`).
2. Start server, open short URL — SPA loads without `/login` redirect (regression check on the gate).
3. WS auth via the existing `{type:'auth', token}` path still works.

- [ ] **Step 5: Commit the final tag**

Once all checks pass:

```bash
git commit --allow-empty -m "feat(auth): web server password protection — manual QA passed"
```

---

## Self-Review Notes

- **Spec coverage:** Every section of `docs/superpowers/specs/2026-04-18-web-password-design.md` maps to at least one task: §3 → Tasks 1–8; §4 → Tasks 6; §5 → Task 4; §6 → Task 10; §7 → Task 11; §9 → Tasks 1, 2, 3, 8, 12. §10 (migration) is covered implicitly — no migration needed.
- **Placeholder scan:** No "TBD" / "TODO" / "similar to" / generic "add validation" phrasing — every step contains actual code or exact commands.
- **Type consistency:** `createWebPasswordService`, `SettingsPort`, `WebPasswordService`, `RateLimiter`, `createRateLimiter`, `normalizeIp`, `registerWebServerAuthHandlers` — all consistent across tasks. The `SettingsPort` adapter in Task 4 uses `{ get, set, delete, getAll }`; Tasks 2/3 use the same shape.
- **Known caveat:** Task 7's Electron call-site update depends on where `registerHandlers` from `webServer.ts` is currently wired in `src/main/`. The Explorer step at the top of that task grep-finds the location. If the bootstrap already passes an engine reference, the change is a single line.
