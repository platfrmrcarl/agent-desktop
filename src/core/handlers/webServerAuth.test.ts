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

  it('registers all channels', () => {
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
