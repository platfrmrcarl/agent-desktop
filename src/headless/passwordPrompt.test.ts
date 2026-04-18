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
