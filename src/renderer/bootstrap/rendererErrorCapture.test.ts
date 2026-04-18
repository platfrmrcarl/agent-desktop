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

  it('labels undefined/null rejection reason explicitly', () => {
    const buf = new ErrorBuffer()
    const restore = installGlobalErrorHandlers(buf)
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: undefined })
    window.dispatchEvent(rejection)
    expect(buf.getAll()[0].message).toContain('(no reason)')
    restore()
  })

  it('annotates cross-origin Script error.', () => {
    const buf = new ErrorBuffer()
    const restore = installGlobalErrorHandlers(buf)
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Script error.', filename: '', lineno: 0, colno: 0 }),
    )
    expect(buf.getAll()[0].message).toContain('(cross-origin, details withheld by browser)')
    restore()
  })
})
