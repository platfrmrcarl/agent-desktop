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
