import { describe, it, expect, afterEach } from 'vitest'
import { parseFontScale, applyFontScale, pxToRem } from './fontScale'

describe('parseFontScale', () => {
  it('returns 1 when input is undefined', () => {
    expect(parseFontScale(undefined)).toBe(1)
  })

  it('returns 1 when input is empty string', () => {
    expect(parseFontScale('')).toBe(1)
  })

  it('returns 1 when input is not numeric', () => {
    expect(parseFontScale('foo')).toBe(1)
  })

  it('returns 1 when input is zero or negative', () => {
    expect(parseFontScale('0')).toBe(1)
    expect(parseFontScale('-1')).toBe(1)
  })

  it('returns scale value when input is a small decimal (modern format)', () => {
    expect(parseFontScale('1')).toBe(1)
    expect(parseFontScale('1.25')).toBe(1.25)
    expect(parseFontScale('0.85')).toBe(0.85)
  })

  it('converts legacy px values (> 4) to scale on 16px UA base', () => {
    expect(parseFontScale('14')).toBe(0.88)
    expect(parseFontScale('16')).toBe(1)
    expect(parseFontScale('20')).toBe(1.25)
    expect(parseFontScale('32')).toBe(2)
  })

  it('rounds legacy conversions to 2 decimals', () => {
    expect(parseFontScale('15')).toBe(0.94)
  })
})

describe('pxToRem', () => {
  it('converts px number to rem string on 16px base', () => {
    expect(pxToRem(16)).toBe('1rem')
    expect(pxToRem(13)).toBe('0.8125rem')
    expect(pxToRem(12)).toBe('0.75rem')
    expect(pxToRem(14)).toBe('0.875rem')
  })
})

describe('applyFontScale', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-scale')
  })

  it('sets --font-scale CSS variable on <html>', () => {
    applyFontScale('1.25')
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25')
  })

  it('uses parsed (migrated) value for legacy input', () => {
    applyFontScale('20')
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.25')
  })

  it('falls back to 1 when input is undefined', () => {
    applyFontScale(undefined)
    expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1')
  })
})
