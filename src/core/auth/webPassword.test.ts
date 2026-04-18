import { describe, it, expect, beforeEach, vi } from 'vitest'
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
