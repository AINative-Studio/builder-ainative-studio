import { describe, it, expect, afterEach } from 'vitest'
import {
  FIRST_RUN_KEY,
  shouldShowFirstRun,
  markFirstRunSeen,
  browserStorage,
  type StorageLike,
} from '@/lib/build/first-run'

/**
 * #319 GR-10 — first-run guide show/dismiss logic. Pure module taking a
 * storage-like interface, so tests run against an in-memory stub (the vitest
 * env is 'node'; no jsdom localStorage exists).
 */
function memoryStorage(entries: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(entries))
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

describe('shouldShowFirstRun (#319)', () => {
  it('shows the guide when the flag has never been set', () => {
    expect(shouldShowFirstRun(memoryStorage())).toBe(true)
  })

  it('hides the guide once the flag is set', () => {
    expect(shouldShowFirstRun(memoryStorage({ [FIRST_RUN_KEY]: '1' }))).toBe(false)
  })

  it('hides the guide for any non-null flag value (forward compat)', () => {
    expect(shouldShowFirstRun(memoryStorage({ [FIRST_RUN_KEY]: 'true' }))).toBe(false)
  })

  it('ignores unrelated keys', () => {
    expect(shouldShowFirstRun(memoryStorage({ other_key: '1' }))).toBe(true)
  })

  it('defaults to showing when storage is null/undefined (SSR)', () => {
    expect(shouldShowFirstRun(null)).toBe(true)
    expect(shouldShowFirstRun(undefined)).toBe(true)
  })

  it('defaults to showing when storage throws (private mode)', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
    }
    expect(shouldShowFirstRun(throwing)).toBe(true)
  })
})

describe('markFirstRunSeen (#319)', () => {
  it('sets the flag so the guide never shows again', () => {
    const store = memoryStorage()
    expect(shouldShowFirstRun(store)).toBe(true)
    markFirstRunSeen(store)
    expect(store.data.get(FIRST_RUN_KEY)).toBe('1')
    expect(shouldShowFirstRun(store)).toBe(false)
  })

  it('is idempotent', () => {
    const store = memoryStorage()
    markFirstRunSeen(store)
    markFirstRunSeen(store)
    expect(shouldShowFirstRun(store)).toBe(false)
  })

  it('is a no-op on null/undefined storage', () => {
    expect(() => markFirstRunSeen(null)).not.toThrow()
    expect(() => markFirstRunSeen(undefined)).not.toThrow()
  })

  it('swallows storage write failures (quota / private mode)', () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => markFirstRunSeen(throwing)).not.toThrow()
  })
})

describe('browserStorage (#319)', () => {
  afterEach(() => {
    delete (globalThis as any).window
  })

  it('returns null when window is undefined (SSR)', () => {
    expect(browserStorage()).toBeNull()
  })

  it('returns null when window exists but localStorage is unavailable', () => {
    ;(globalThis as any).window = {}
    expect(browserStorage()).toBeNull()
  })

  it('returns window.localStorage when available', () => {
    const ls = memoryStorage()
    ;(globalThis as any).window = { localStorage: ls }
    expect(browserStorage()).toBe(ls)
  })

  it('returns null when accessing localStorage throws (private mode)', () => {
    ;(globalThis as any).window = {}
    Object.defineProperty((globalThis as any).window, 'localStorage', {
      get() {
        throw new Error('SecurityError')
      },
    })
    expect(browserStorage()).toBeNull()
  })
})

describe('end-to-end flag key (#319)', () => {
  it('uses the ainative-first-run-seen key', () => {
    expect(FIRST_RUN_KEY).toBe('ainative-first-run-seen')
  })
})
