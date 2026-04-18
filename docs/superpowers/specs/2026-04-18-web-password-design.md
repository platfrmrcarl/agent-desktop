# Web Server Password Protection — Design Spec

**Date** : 2026-04-18
**Status** : Draft (awaiting implementation plan)
**Scope** : Add optional password authentication to the LAN web server / mobile client

---

## 1. Context & Motivation

The existing web server (`src/core/services/webServer.ts`) exposes the Electron renderer over LAN using:
- A random 32-byte hex `token` (regenerated at each startup, never persisted)
- A short code `/s/<shortCode>` in the URL that injects the token client-side
- Possession of the URL = full access — no identity verification

This "capability-based" model is convenient on a trusted home LAN, but fragile:
- If the URL leaks (shared screen, router admin panel, browser history) anyone on the LAN gains full access.
- In headless/server mode (`node out/headless/index.js --server`) running 24/7, a persistent credential would provide a much stronger access control model than a token that changes at every restart.
- In `accessMode: 'all'` mode, the server is reachable from any remote IP — relying purely on a short code is dangerous.

**Goal** : give the user an **opt-in** password that stacks on top of the existing short-code mechanism, and replaces the WS token auth when active. Zero impact on users who don't enable it.

---

## 2. Decisions Summary

| Topic | Decision |
|---|---|
| Semantic | Password is **optional** — when set: double-factor (URL + password). When unset: current behavior unchanged. |
| Crypto | `scryptSync` (Node builtin, zero deps). Params: `N=16384, r=8, p=1`, 64-byte output. ~80ms/verify. |
| Storage format | PHC-like string: `$scrypt$N=16384,r=8,p=1$<b64salt>$<b64hash>` — parseable, forward-compatible if we migrate to argon2id. |
| Login UX | Dedicated HTML login page served BEFORE the SPA. HttpOnly cookie. Cookie covers HTTP and WebSocket (transmitted in upgrade handshake). |
| Session duration | Default 7 days, configurable. "Remember me" checkbox extends to 30 days. Sliding expiration. |
| Session revocation | Rotate `server_sessionSecret` on password change/clear → all HMAC cookies invalidated atomically. Stateless (no session table). |
| Rate limiting | Per-IP in-memory: 5 attempts/min, 15-min ban after 20 failures. IPv6-mapped normalized. |
| UI entry point | `Settings > Web Server > Password authentication` — enable toggle, set/change/clear actions, session duration field. |
| CLI entry point | `node out/headless/index.js --set-password` (interactive TTY prompt). `--clear-password` to remove. |
| WS auth (when password active) | Token-in-URL replaced by cookie validation at `upgrade` time. Simpler, single source of truth. |
| WS auth (when password inactive) | Unchanged — current `{type: 'auth', token}` flow remains. |

---

## 3. Architecture

### 3.1 New modules

```
src/core/auth/
├── webPassword.ts         # setPassword, verifyPassword, issueCookie, validateCookie
├── webPassword.test.ts
├── rateLimiter.ts         # Per-IP attempt tracking, ban logic
├── rateLimiter.test.ts
└── index.ts               # Barrel — public API only
```

**`webPassword.ts` public API** :

```ts
export interface WebPasswordService {
  setPassword(plaintext: string): Promise<void>
  clearPassword(): Promise<void>
  verifyPassword(plaintext: string): Promise<boolean>
  isPasswordSet(): boolean
  issueCookie(rememberMe: boolean): string
    // Returns the cookie string. TTL = `server_rememberDurationDays` if rememberMe,
    // else `server_sessionDurationDays`. Both are read fresh from settings each call.
  validateCookie(cookieValue: string): boolean
  getSessionDurationDays(): number
  setSessionDurationDays(days: number): void
  getRememberDurationDays(): number
  setRememberDurationDays(days: number): void
}
```

Implementation is a factory that takes the `SettingsService` as dependency (so it works identically in Electron and headless). No module-level state beyond what SettingsService already persists.

**`rateLimiter.ts` public API** :

```ts
export interface RateLimiter {
  check(ip: string): { allowed: true } | { allowed: false; retryAfterSeconds: number }
  recordAttempt(ip: string, success: boolean): void
}
```

Pure in-memory — stateless across server restarts (acceptable: restart clears any legitimate user's ban too, no harm).

### 3.2 Changes to `webServer.ts`

- New module state: `webPassword: WebPasswordService | null`, `rateLimiter: RateLimiter`.
- **`requestHandler`** — add login gate at top:
  - `/login` (GET) → serve static HTML login page (standalone, not the SPA).
  - `/login` (POST) → consume rate limit, verify password, set cookie, 302.
  - `/logout` (POST) → clear cookie, 302 to `/login`.
  - Any other path : if `webPassword.isPasswordSet()` AND no valid cookie → 302 to `/login`.
  - Otherwise → existing behavior (shortCode check, SPA serve, asset serve).
- **`upgradeHandler`** — add cookie gate:
  - If `webPassword.isPasswordSet()` AND no valid cookie in `req.headers.cookie` → `socket.destroy()`.
  - If cookie valid → `handleUpgrade` WITHOUT requiring the `{type: 'auth', token}` handshake afterwards (the ws handler auto-authenticates such clients).
- **Shim script generation** — when password is active, don't inject the token (client doesn't need it; WS auth is cookie-based).

### 3.3 New IPC handlers

Module: `src/core/handlers/webServerAuth.ts` (new file, follows existing handler conventions).

```
server:setPassword(plaintext)
server:clearPassword()
server:isPasswordSet() → boolean
server:getSessionDurationDays() → number
server:setSessionDurationDays(days)
server:getRememberDurationDays() → number
server:setRememberDurationDays(days)
```

Registered via `registerHandlers` pattern like other `src/core/handlers/*.ts` modules.

### 3.4 CLI integration (headless)

Add to `src/headless/index.ts`:
- New one-shot mode (`isOneShot`) triggered by `--set-password` or `--clear-password`.
- Loads engine, gets `webPassword` service, runs interactive readline prompt.
- Validates `process.stdout.isTTY` — fails cleanly if not a TTY.
- `--set-password`: masked input (chars echoed as `*`), confirmation prompt, min 8 chars validation.

---

## 4. Data Flow

### 4.1 First login with password set

```
Client                                Server
──────                                ──────
GET /s/<shortCode>              ───►  isAllowedRemote ? no → 403
                                      shortCode match ?   no → 403
                                      isPasswordSet()     no → serve SPA (current flow)
                                                          yes → 302 Location: /login

GET /login                      ───►  serve static HTML (password form)

POST /login                     ───►  rateLimiter.check(ip)
{ password, remember }                  denied → 429 + Retry-After
                                        allowed → verifyPassword()    [scrypt, ~80ms]
                                                  false → recordAttempt(ip, false), 401
                                                  true  → recordAttempt(ip, true)
                                                          issueCookie(remember)
                                                          Set-Cookie: agent_session=<b64>;
                                                             HttpOnly; Secure; SameSite=Strict;
                                                             Max-Age={7d or 30d}; Path=/
                                                          302 Location: /s/<shortCode>
```

### 4.2 Authenticated navigation

```
GET /s/<shortCode>              ───►  cookie present & validateCookie() ok?
                                        yes → serve SPA (no token injection when password active)
                                        no  → 302 /login

GET /assets/...                 ───►  cookie gate → same behavior

WS upgrade /ws                  ───►  req.headers.cookie contains agent_session ?
                                        no → socket.destroy()
                                        yes → validateCookie() ?
                                                false → socket.destroy()
                                                true  → handleUpgrade()
                                                        client is pre-authenticated
                                                        (authenticatedClients.add on connection)
```

### 4.3 Cookie format (stateless HMAC)

```
payload = `${expiresAtUnixMs}`
mac     = hmacSha256(sessionSecret, payload)
cookie  = base64url(`${payload}.${mac.hex()}`)

validateCookie(c):
  1. base64url-decode, split on "."
  2. recompute HMAC(sessionSecret, payload)
  3. crypto.timingSafeEqual(stored_mac, recomputed_mac)
  4. parseInt(payload) > Date.now()
  5. All three → true
```

### 4.4 Global revocation

```
setPassword(new):
  salt     = randomBytes(16)
  hash     = scryptSync(new, salt, 64, {N: 16384, r: 8, p: 1})
  settings.set('server_passwordHash', formatPhc(hash, salt))
  settings.set('server_sessionSecret', randomBytes(32).hex())
  → all cookies signed with the previous secret are now invalid.

clearPassword():
  settings.delete('server_passwordHash')
  settings.delete('server_sessionSecret')
  → all cookies invalidated, server reverts to token-based WS auth.
```

---

## 5. Settings schema

Additions to the `settings` table (no migration needed — key/value TEXT):

| Key | Type | Default | Cascaded | Description |
|---|---|---|---|---|
| `server_passwordHash` | TEXT (nullable) | `null` | No (global-only) | PHC-like string. `null` = feature disabled. |
| `server_sessionSecret` | TEXT (nullable) | `null` | No | 32-byte hex. Paired with `server_passwordHash` (both `null` or both set). |
| `server_sessionDurationDays` | TEXT | `"7"` | No | Standard session length in days. |
| `server_rememberDurationDays` | TEXT | `"30"` | No | "Remember me" session length in days. |

All new keys are global-only (not in AIOverrides cascade) — they are server-scoped, not per-conversation.

---

## 6. UI Design

### 6.1 Settings section

Located in the existing `Settings > Web Server` pane, below the port/accessMode/shortCode controls:

```
┌─ Password authentication ──────────────────────┐
│                                                │
│  [○] Disabled     [●] Enabled                  │
│                                                │
│  Status: Password set                          │
│                                                │
│  Session duration (days):    [  7  ]           │
│                                                │
│  [ Change password ]   [ Disable ]             │
│                                                │
└────────────────────────────────────────────────┘
```

- Enable toggle disabled → clears hash, disable action confirmed by modal.
- Enable toggle enabled but no hash → "Set password" modal required before toggle commits.
- Change password → modal with two `<input type="password">` (new + confirmation), min 8 chars client-side validation.
- Disable → confirmation modal "All active sessions will be logged out".

### 6.2 Security indicators

- If `server_accessMode === 'all'` AND `server_passwordHash === null`:
  - Red warning banner above the whole Web Server section: **"⚠ Internet access enabled without a password. Enable a password to protect your data."**
- Tooltip near the password toggle: "Recommended for LAN use, strongly recommended for Internet access."

### 6.3 Renderer API (preload `window.agent.server.*`)

New methods added to the existing `server` namespace (no new top-level namespace):

```ts
window.agent.server.setPassword(plaintext: string): Promise<void>
window.agent.server.clearPassword(): Promise<void>
window.agent.server.isPasswordSet(): Promise<boolean>
window.agent.server.getSessionDurationDays(): Promise<number>
window.agent.server.setSessionDurationDays(days: number): Promise<void>
window.agent.server.getRememberDurationDays(): Promise<number>
window.agent.server.setRememberDurationDays(days: number): Promise<void>
```

The plaintext password NEVER round-trips back to the renderer — only `isPasswordSet(): boolean` is queryable.

---

## 7. CLI Design (Headless)

### 7.1 `--set-password`

```bash
$ node out/headless/index.js --set-password
New password: ********
Confirm:      ********
Password set. Existing sessions invalidated.
$
```

- Fails with exit code 1 if `!process.stdout.isTTY` (no interactive input).
- Fails if passwords don't match or length < 8.
- Prints to stderr on error, stdout on success.

### 7.2 `--clear-password`

```bash
$ node out/headless/index.js --clear-password
Password cleared. Server reverted to token-based authentication.
$
```

### 7.3 Compatibility

- Not combinable with `--server`, `--discord`, `--tick`, `--run-task` (added to existing `isLongRunning && isOneShot` mutual exclusion check).
- Requires same DB access as other modes (uses `AGENT_DB_PATH` env var if set).

---

## 8. Security Model

### 8.1 Threat model

**In scope** :
- LAN attacker with the short code but no password (e.g., URL leaked in screen share).
- Internet attacker when `accessMode: 'all'` + no password (currently trivial compromise; this feature lets the user close the hole).
- Brute force of the password over LAN.
- Stolen cookie from a client (contained by cookie flags + HMAC + expiration + revocation).
- DB theft (scrypt hash with random salt = computationally infeasible offline).

**Out of scope** :
- Multiple user accounts / per-user permissions (single-user model).
- Password reset flow (the user owns the machine and can always use `--set-password` CLI or Electron UI).
- 2FA / TOTP.
- IP allowlisting beyond the existing LAN / 'all' modes.
- Auditing / login history.

### 8.2 Security properties

- Cookie is `HttpOnly` → inaccessible to JS (no XSS exfiltration).
- Cookie is `Secure` over HTTPS (fallback HTTP mode carries security warning in logs).
- Cookie is `SameSite=Strict` → CSRF protection.
- HMAC-SHA256 with 32-byte secret → forgery infeasible.
- `crypto.timingSafeEqual` for HMAC comparison → no timing side-channel.
- Rate limiter runs BEFORE password verification → attacker cannot DoS the CPU via endless scrypt calls.
- IPv6-mapped IPs normalized → rate limit cannot be bypassed by swapping `::ffff:` prefix.
- Password change rotates `server_sessionSecret` → atomic revocation of all existing cookies.

### 8.3 Known trade-offs

- **Accepted**: In `accessMode: 'all'` mode, multiple remote attackers behind the same NAT could exhaust the rate limit quota of a legitimate user on that NAT. Documented as a known limitation — LAN-only mode (the default) is not affected.
- **Accepted**: No password reset flow for forgotten passwords — user always has OS-level access to the machine running the server, so they can clear the hash via Electron UI or `--clear-password` CLI.
- **Accepted**: HTTP fallback mode (when OpenSSL unavailable) is strongly discouraged when a password is set — cookies travel in plaintext. A warning is logged at startup and shown in UI.

---

## 9. Testing Strategy

### 9.1 Unit tests

`src/core/auth/webPassword.test.ts`:
- `setPassword` persists hash and sessionSecret.
- `verifyPassword` : true for correct, false for incorrect, false when no hash set.
- `issueCookie` → `validateCookie` round-trip succeeds.
- Expired cookie → invalid.
- Tampered cookie (bit flip in payload or mac) → invalid.
- Cookie issued before `sessionSecret` rotation → invalid after rotation.
- PHC string format round-trip (set → verify with same params).
- Weak password rejection (length < 8).

`src/core/auth/rateLimiter.test.ts`:
- 5 failures allowed, 6th blocked.
- Success resets counter.
- Ban expires after configured window (fake timer).
- IPv6-mapped normalization (`::ffff:1.2.3.4` equivalent to `1.2.3.4`).
- Concurrent attempts from different IPs tracked independently.

### 9.2 Integration tests

`src/main/services/webServer.test.ts` (extend existing file):
- GET `/` with no password set → serves SPA (regression).
- GET `/` with password set + no cookie → 302 to `/login`.
- GET `/login` → serves HTML login page.
- POST `/login` with correct password → Set-Cookie header + 302.
- POST `/login` with incorrect password → 401 + records failed attempt.
- POST `/login` 6 times from same IP → 6th returns 429.
- WS upgrade with password set + no cookie → socket destroyed.
- WS upgrade with valid cookie → handleUpgrade succeeds, client is pre-authenticated.
- Change password (setPassword called with new value) → previously issued cookie invalid.
- Clear password → reverts to current token-based flow (regression-safe).

### 9.3 Coverage

Target 70% line / 60% branch for new modules (project threshold). Auth modules are small (<200 lines each), easily achievable.

---

## 10. Migration & Backward Compatibility

- **Zero breaking changes** for existing users — password defaults to `null` → current behavior unchanged.
- No DB schema migration (new rows in existing `settings` key/value table).
- Client compatibility: the web client is any modern browser, which natively supports HTML forms and cookies — no client-side code upgrade required when enabling the password. When the password is set, the WebSocket `{type: 'auth', token}` handshake is no longer needed (cookie auth covers WS) but remains implemented for the password-inactive case.
- All WS message types unchanged; the `{type: 'auth', token}` handshake still works when password is NOT set.

---

## 11. Implementation Phases (preview)

Detailed plan will be produced by the `writing-plans` skill. High-level sequence:

1. **Auth core modules** (`webPassword.ts`, `rateLimiter.ts`) with full unit test coverage.
2. **WebServer integration** (login routes, cookie gate, WS upgrade gate).
3. **Login HTML page** (standalone, minimal CSS, no SPA deps).
4. **IPC handlers** (`webServerAuth.ts`) + preload API.
5. **Settings UI** (password section in Web Server settings).
6. **Headless CLI** (`--set-password`, `--clear-password`).
7. **End-to-end tests** and documentation.

---

## 12. Open Questions

None at design-approval time. Decisions locked above.

---

## 13. Non-Goals

Explicitly out of scope for this spec:
- Multi-user accounts.
- OAuth / SSO integration.
- Password strength meter (min-length check only).
- Auditing / rate-limit dashboard in UI.
- Persistent ban list across restarts.
- Per-device session management (view/revoke individual sessions).
