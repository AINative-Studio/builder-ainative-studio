import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { memoizeWithTTL, memoizeWithTTLAsync, memoizeWithLRU } from '@/lib/utils/memoize'

describe('lib/utils/memoize', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('memoizeWithTTL', () => {
    it('returns a cached value for the same args without calling fn again', () => {
      const fn = vi.fn((a: number, b: number) => a + b)
      const memoized = memoizeWithTTL(fn, 1000)

      expect(memoized(1, 2)).toBe(3)
      expect(memoized(1, 2)).toBe(3)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('derives distinct cache entries per distinct argument list (JSON key)', () => {
      const fn = vi.fn((a: number, b: number) => a + b)
      const memoized = memoizeWithTTL(fn, 1000)

      memoized(1, 2)
      memoized(2, 3)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('returns the stale value immediately on expiry while triggering a synchronous background refresh', () => {
      let counter = 0
      const fn = vi.fn(() => ++counter)
      const memoized = memoizeWithTTL(fn, 1000)

      expect(memoized()).toBe(1)
      vi.advanceTimersByTime(1500) // past TTL

      // Stale read: returns the OLD cached value (1), not the refreshed one (2),
      // even though a background refresh runs synchronously inside this call.
      expect(memoized()).toBe(1)
      expect(fn).toHaveBeenCalledTimes(2)

      // Next call within the new TTL window returns the freshly refreshed value.
      expect(memoized()).toBe(2)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('defaults to a 5 minute TTL when none is provided', () => {
      const fn = vi.fn(() => 'value')
      const memoized = memoizeWithTTL(fn)

      memoized()
      vi.advanceTimersByTime(4 * 60 * 1000) // under 5 min
      memoized()
      expect(fn).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2 * 60 * 1000) // now past 5 min total
      memoized()
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('memoizeWithTTLAsync', () => {
    it('returns a cached resolved value without calling fn again while fresh', async () => {
      const fn = vi.fn(async (x: number) => x * 2)
      const memoized = memoizeWithTTLAsync(fn, 1000)

      await expect(memoized(5)).resolves.toBe(10)
      await expect(memoized(5)).resolves.toBe(10)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('dedups concurrent cold-miss calls for the same key into a single underlying call', async () => {
      let resolveFn: (v: number) => void
      const fn = vi.fn((_key: string) => new Promise<number>((resolve) => { resolveFn = resolve }))
      const memoized = memoizeWithTTLAsync(fn, 1000)

      const p1 = memoized('k')
      const p2 = memoized('k')
      resolveFn!(42)

      await expect(p1).resolves.toBe(42)
      await expect(p2).resolves.toBe(42)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('returns the stale cached value immediately while refreshing in the background on expiry', async () => {
      let counter = 0
      const fn = vi.fn(async () => ++counter)
      const memoized = memoizeWithTTLAsync(fn, 1000)

      await expect(memoized()).resolves.toBe(1)

      vi.advanceTimersByTime(1500)

      // Stale read returns the OLD value (1) immediately - it does not await
      // the background refresh it triggers.
      const staleResult = await memoized()
      expect(staleResult).toBe(1)
      expect(fn).toHaveBeenCalledTimes(2)

      // Let the background refresh's already-resolved promise chain flush.
      await Promise.resolve()
      await Promise.resolve()

      // A later call within the new TTL window now sees the refreshed value.
      const refreshedResult = await memoized()
      expect(refreshedResult).toBe(2)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('does not start a second background refresh while one is already in flight for a stale key', async () => {
      let callCount = 0
      const pending: Array<(v: number) => void> = []
      const fn = vi.fn(() => {
        callCount++
        return new Promise<number>((resolve) => pending.push(resolve))
      })
      const memoized = memoizeWithTTLAsync(fn, 1000)

      // First call is a cold miss: resolve it to seed the cache.
      const firstCall = memoized()
      pending[0]!(1)
      await expect(firstCall).resolves.toBe(1)
      expect(callCount).toBe(1)

      vi.advanceTimersByTime(1500) // expire the cached entry

      // First stale read: entry is stale and nothing is in flight yet, so it
      // starts a background refresh and returns the OLD cached value (1)
      // immediately, without waiting on that refresh.
      const staleA = await memoized()
      expect(staleA).toBe(1)
      expect(callCount).toBe(2) // one refresh call started

      // Second stale read: the entry is still stale (the refresh above
      // hasn't resolved yet) AND inFlight is now set for the key, so this
      // call falls through to the cold-miss dedup branch and returns the
      // SAME in-flight refresh promise - it does NOT start another fn() call.
      const staleBPromise = memoized()
      expect(callCount).toBe(2) // still just the one refresh in flight

      pending[1]!(2) // resolve the in-flight refresh
      await expect(staleBPromise).resolves.toBe(2)
      expect(callCount).toBe(2) // confirms no duplicate refresh was started
    })

    it('uses a 5 minute default TTL when none is provided', async () => {
      const fn = vi.fn(async () => 'v')
      const memoized = memoizeWithTTLAsync(fn)

      await memoized()
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('memoizeWithLRU', () => {
    it('caches by the custom keyFn and avoids recomputation for the same key', () => {
      const fn = vi.fn((obj: { id: number; label: string }) => obj.label.toUpperCase())
      const memoized = memoizeWithLRU(fn, (obj) => String(obj.id), 10)

      expect(memoized({ id: 1, label: 'a' })).toBe('A')
      expect(memoized({ id: 1, label: 'ignored-on-cache-hit' })).toBe('A')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('evicts the oldest entry once the cache exceeds maxSize', () => {
      const fn = vi.fn((n: number) => n * 10)
      const memoized = memoizeWithLRU(fn, (n) => String(n), 2)

      memoized(1) // cache: [1]
      memoized(2) // cache: [1,2]
      memoized(3) // over limit -> evicts 1 -> cache: [2,3]

      memoized(1) // recomputed since evicted
      expect(fn).toHaveBeenCalledTimes(4) // 1,2,3,1-again
    })

    it('treats a re-accessed key as most-recently-used, protecting it from eviction', () => {
      const fn = vi.fn((n: number) => n * 10)
      const memoized = memoizeWithLRU(fn, (n) => String(n), 2)

      memoized(1) // [1]
      memoized(2) // [1,2]
      memoized(1) // re-access 1, moves it to the end -> [2,1]
      memoized(3) // over limit -> evicts 2 (oldest) -> [1,3]

      memoized(1) // still cached, no recompute
      expect(fn).toHaveBeenCalledTimes(3) // 1, 2, 3 (second access to 1 and 1 again are cache hits)

      memoized(2) // was evicted -> recompute
      expect(fn).toHaveBeenCalledTimes(4)
    })

    it('defaults maxSize to 100 when not provided', () => {
      const fn = vi.fn((n: number) => n)
      const memoized = memoizeWithLRU(fn, (n) => String(n))

      for (let i = 0; i < 100; i++) memoized(i)
      expect(fn).toHaveBeenCalledTimes(100)

      // All 100 should still be cached (not yet over the default limit).
      memoized(0)
      expect(fn).toHaveBeenCalledTimes(100)
    })
  })
})
