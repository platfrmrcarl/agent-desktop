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
