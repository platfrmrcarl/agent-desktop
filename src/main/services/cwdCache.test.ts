/**
 * Tests for the shared CWD cache used by messages.ts (read/write) and
 * conversations.ts (invalidate on cwd change).
 *
 * The module is a singleton — both consumers share the same Map. These tests
 * verify:
 *   - module-level singleton sharing (mutations are visible across importers)
 *   - invalidation removes a single key without touching siblings
 *   - the cache survives interleaved reads/writes for unrelated keys
 *     (sql.js is single-threaded, so the only "concurrency" we model is
 *     interleaved sync calls — there is no real race window)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { CWD_CACHE_MAX, cwdCache, invalidateCwdCache } from './cwdCache'

describe('cwdCache', () => {
  beforeEach(() => {
    // Module-level singleton: clear between tests so they cannot leak state.
    cwdCache.clear()
  })

  describe('module shape', () => {
    it('exports a Map instance', () => {
      expect(cwdCache).toBeInstanceOf(Map)
    })

    it('CWD_CACHE_MAX is a positive integer', () => {
      expect(typeof CWD_CACHE_MAX).toBe('number')
      expect(Number.isInteger(CWD_CACHE_MAX)).toBe(true)
      expect(CWD_CACHE_MAX).toBeGreaterThan(0)
    })

    it('starts empty after clear()', () => {
      expect(cwdCache.size).toBe(0)
    })
  })

  describe('invalidateCwdCache', () => {
    it('removes the entry for a single conversation id', () => {
      cwdCache.set(1, '/tmp/conv-1')
      cwdCache.set(2, '/tmp/conv-2')
      cwdCache.set(3, '/tmp/conv-3')

      invalidateCwdCache(2)

      expect(cwdCache.has(1)).toBe(true)
      expect(cwdCache.has(2)).toBe(false)
      expect(cwdCache.has(3)).toBe(true)
      expect(cwdCache.size).toBe(2)
    })

    it('is a no-op for ids that are not cached', () => {
      cwdCache.set(7, '/tmp/conv-7')
      invalidateCwdCache(99)

      expect(cwdCache.size).toBe(1)
      expect(cwdCache.get(7)).toBe('/tmp/conv-7')
    })

    it('is idempotent — repeated invalidation does not throw', () => {
      cwdCache.set(5, '/tmp/conv-5')
      invalidateCwdCache(5)
      invalidateCwdCache(5)
      invalidateCwdCache(5)
      expect(cwdCache.has(5)).toBe(false)
    })

    it('invalidates only the targeted key when many siblings exist', () => {
      for (let i = 1; i <= 50; i++) {
        cwdCache.set(i, `/tmp/conv-${i}`)
      }
      invalidateCwdCache(25)
      expect(cwdCache.size).toBe(49)
      expect(cwdCache.has(25)).toBe(false)
      // Confirm no neighbours were collateral-damaged.
      expect(cwdCache.has(24)).toBe(true)
      expect(cwdCache.has(26)).toBe(true)
    })
  })

  describe('singleton sharing', () => {
    it('the same Map instance is returned to every importer', async () => {
      // Re-import dynamically: the module cache should hand back the exact
      // same Map object, not a fresh copy. This is the property that lets
      // conversations.ts invalidate keys that messages.ts populated.
      const reimported = await import('./cwdCache')
      expect(reimported.cwdCache).toBe(cwdCache)
      expect(reimported.invalidateCwdCache).toBe(invalidateCwdCache)
    })

    it('writes from one consumer are visible to another via the singleton', async () => {
      cwdCache.set(42, '/tmp/from-writer')
      const reader = await import('./cwdCache')
      expect(reader.cwdCache.get(42)).toBe('/tmp/from-writer')

      reader.invalidateCwdCache(42)
      // Writer's reference observes the deletion immediately.
      expect(cwdCache.has(42)).toBe(false)
    })
  })

  describe('stale-read behavior (interleaved sync ops)', () => {
    it('a stale read returns the OLD value until invalidate is called', () => {
      // Models the bug-shape we care about: if a caller forgets to
      // invalidate after a cwd change, get() returns the old path.
      cwdCache.set(1, '/old/path')
      expect(cwdCache.get(1)).toBe('/old/path')

      // Imagine the underlying source-of-truth changed but invalidate was skipped:
      // the cache continues to serve the stale value.
      expect(cwdCache.get(1)).toBe('/old/path')

      // Once invalidated, subsequent reads miss → caller refills from DB.
      invalidateCwdCache(1)
      expect(cwdCache.get(1)).toBeUndefined()
    })

    it('interleaved set/invalidate/set on the same key behaves last-write-wins', () => {
      cwdCache.set(10, '/a')
      cwdCache.set(10, '/b')
      expect(cwdCache.get(10)).toBe('/b')
      invalidateCwdCache(10)
      expect(cwdCache.get(10)).toBeUndefined()
      cwdCache.set(10, '/c')
      expect(cwdCache.get(10)).toBe('/c')
    })

    it('parallel-shaped sync writes to different keys do not interfere', () => {
      // Simulate many "concurrent" set calls (single-threaded JS, but the
      // shape mimics how messages handlers might be invoked back-to-back
      // for different conversations).
      const writes = Array.from({ length: 200 }, (_, i) => [i + 1, `/cwd/${i + 1}`] as const)
      for (const [k, v] of writes) cwdCache.set(k, v)
      expect(cwdCache.size).toBe(200)
      for (const [k, v] of writes) expect(cwdCache.get(k)).toBe(v)
    })
  })
})
