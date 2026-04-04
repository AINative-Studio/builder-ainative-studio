/**
 * Memoization utilities with TTL and LRU support.
 * Ported from cody-cli patterns (src/utils/memoize.ts)
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * TTL-based memoization with background refresh.
 * Returns stale value immediately while refreshing in background.
 * In-flight dedup prevents concurrent refreshes.
 */
export function memoizeWithTTL<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  ttlMs: number = 5 * 60 * 1000,
): (...args: Args) => Result {
  const cache = new Map<string, CacheEntry<Result>>()
  const refreshing = new Set<string>()

  return (...args: Args): Result => {
    const key = JSON.stringify(args)
    const entry = cache.get(key)
    const now = Date.now()

    if (entry) {
      if (now < entry.expiresAt) {
        return entry.value
      }
      // Stale - return immediately but trigger background refresh
      if (!refreshing.has(key)) {
        refreshing.add(key)
        try {
          const result = fn(...args)
          cache.set(key, { value: result, expiresAt: now + ttlMs })
        } finally {
          refreshing.delete(key)
        }
      }
      return entry.value
    }

    const result = fn(...args)
    cache.set(key, { value: result, expiresAt: now + ttlMs })
    return result
  }
}

/**
 * Async TTL-based memoization with cold-miss dedup.
 * Prevents multiple concurrent initial fetches for the same key.
 */
export function memoizeWithTTLAsync<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
  ttlMs: number = 5 * 60 * 1000,
): (...args: Args) => Promise<Result> {
  const cache = new Map<string, CacheEntry<Result>>()
  const inFlight = new Map<string, Promise<Result>>()

  return async (...args: Args): Promise<Result> => {
    const key = JSON.stringify(args)
    const entry = cache.get(key)
    const now = Date.now()

    if (entry && now < entry.expiresAt) {
      return entry.value
    }

    // Return stale while refreshing in background
    if (entry && !inFlight.has(key)) {
      const refresh = fn(...args)
        .then((result) => {
          cache.set(key, { value: result, expiresAt: Date.now() + ttlMs })
          return result
        })
        .finally(() => inFlight.delete(key))
      inFlight.set(key, refresh)
      return entry.value
    }

    // Cold miss - dedup concurrent calls
    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = fn(...args)
      .then((result) => {
        cache.set(key, { value: result, expiresAt: Date.now() + ttlMs })
        return result
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}

/**
 * LRU-bounded memoization to prevent unbounded memory growth.
 */
export function memoizeWithLRU<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  keyFn: (...args: Args) => string,
  maxSize: number = 100,
): (...args: Args) => Result {
  const cache = new Map<string, Result>()

  return (...args: Args): Result => {
    const key = keyFn(...args)

    if (cache.has(key)) {
      const value = cache.get(key)!
      // Move to end (most recently used)
      cache.delete(key)
      cache.set(key, value)
      return value
    }

    const result = fn(...args)
    cache.set(key, result)

    // Evict oldest entries if over limit
    if (cache.size > maxSize) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }

    return result
  }
}
