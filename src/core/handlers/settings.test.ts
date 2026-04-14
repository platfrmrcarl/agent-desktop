import { describe, it, expect, beforeEach } from 'vitest'
import { DispatchRegistry } from '../dispatch'
import { registerSettingsHandlers } from './settings'
import { createTestDb } from '../../main/__tests__/db-helper'

describe('settings handlers', () => {
  let dispatch: DispatchRegistry

  beforeEach(async () => {
    dispatch = new DispatchRegistry()
    const db = await createTestDb()
    registerSettingsHandlers(dispatch, db as any)
  })

  it('registers settings:get handler', () => {
    expect(dispatch.has('settings:get')).toBe(true)
  })

  it('registers settings:set handler', () => {
    expect(dispatch.has('settings:set')).toBe(true)
  })

  it('settings:get returns all settings', async () => {
    const get = dispatch.get('settings:get')!
    const result = await get() as Record<string, string>
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })

  it('settings:set persists a value', async () => {
    const set = dispatch.get('settings:set')!
    const get = dispatch.get('settings:get')!
    await set('theme', 'dark')
    const all = await get() as Record<string, string>
    expect(all['theme']).toBe('dark')
  })
})
