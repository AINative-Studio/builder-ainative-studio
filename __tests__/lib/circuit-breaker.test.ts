import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CircuitBreaker,
  getCircuitBreaker,
  resetAllCircuitBreakers,
} from '@/lib/circuit-breaker'

/**
 * Circuit breaker for external-dependency calls (issue #1191).
 *
 * This app is single-process-per-replica (no shared state across instances
 * needed), so an in-memory failure counter + timestamp per dependency key
 * is the real, sufficient implementation — not a distributed-systems
 * problem. These tests prove the three states a real breaker needs:
 *
 *  - CLOSED: calls go through normally, failures are counted
 *  - OPEN: after N consecutive failures within the window, further calls
 *    short-circuit immediately WITHOUT invoking the underlying function
 *    (this is what prevents hanging on another real network call)
 *  - HALF_OPEN -> CLOSED/OPEN: after the cooldown elapses, exactly one
 *    trial call is allowed through; success closes the breaker, failure
 *    re-opens it for another cooldown window
 */
describe('CircuitBreaker', () => {
  beforeEach(() => {
    resetAllCircuitBreakers()
    vi.useRealTimers()
  })

  it('starts closed and allows calls through', async () => {
    const breaker = new CircuitBreaker('test-dep-1', { failureThreshold: 3, cooldownMs: 1000 })
    const fn = vi.fn().mockResolvedValue('ok')

    const result = await breaker.execute(fn)

    expect(result).toEqual({ success: true, value: 'ok', shortCircuited: false })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(breaker.getState()).toBe('closed')
  })

  it('counts consecutive failures and stays closed below the threshold', async () => {
    const breaker = new CircuitBreaker('test-dep-2', { failureThreshold: 3, cooldownMs: 1000 })
    const fn = vi.fn().mockRejectedValue(new Error('network down'))

    await breaker.execute(fn)
    await breaker.execute(fn)

    expect(breaker.getState()).toBe('closed')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('opens the breaker after N consecutive failures and short-circuits further calls without invoking the function', async () => {
    const breaker = new CircuitBreaker('test-dep-3', { failureThreshold: 3, cooldownMs: 60_000 })
    const fn = vi.fn().mockRejectedValue(new Error('network down'))

    await breaker.execute(fn)
    await breaker.execute(fn)
    await breaker.execute(fn) // 3rd consecutive failure trips the breaker

    expect(breaker.getState()).toBe('open')
    expect(fn).toHaveBeenCalledTimes(3)

    // Next call must short-circuit: no real network attempt made.
    const result = await breaker.execute(fn)

    expect(result.shortCircuited).toBe(true)
    expect(result.success).toBe(false)
    expect(fn).toHaveBeenCalledTimes(3) // still 3 — the 4th call never invoked fn
  })

  it('a success resets the consecutive-failure count', async () => {
    const breaker = new CircuitBreaker('test-dep-4', { failureThreshold: 3, cooldownMs: 1000 })
    const failFn = vi.fn().mockRejectedValue(new Error('down'))
    const okFn = vi.fn().mockResolvedValue('ok')

    await breaker.execute(failFn)
    await breaker.execute(failFn)
    await breaker.execute(okFn) // success in between resets the streak
    await breaker.execute(failFn)
    await breaker.execute(failFn)

    // Only 2 consecutive failures since the reset — breaker should still be closed.
    expect(breaker.getState()).toBe('closed')
  })

  it('transitions to half-open after the cooldown elapses and allows exactly one trial call', async () => {
    vi.useFakeTimers()
    const breaker = new CircuitBreaker('test-dep-5', { failureThreshold: 2, cooldownMs: 5000 })
    const fn = vi.fn().mockRejectedValue(new Error('down'))

    await breaker.execute(fn)
    await breaker.execute(fn) // trips open

    expect(breaker.getState()).toBe('open')

    // Still within cooldown: short-circuits.
    const stillOpen = await breaker.execute(fn)
    expect(stillOpen.shortCircuited).toBe(true)

    // Advance past cooldown.
    vi.advanceTimersByTime(5001)

    expect(breaker.getState()).toBe('half-open')

    // The trial call during half-open DOES invoke the function.
    const okFn = vi.fn().mockResolvedValue('recovered')
    const trial = await breaker.execute(okFn)

    expect(trial.shortCircuited).toBe(false)
    expect(okFn).toHaveBeenCalledTimes(1)
    expect(breaker.getState()).toBe('closed')

    vi.useRealTimers()
  })

  it('a failed half-open trial re-opens the breaker for another full cooldown', async () => {
    vi.useFakeTimers()
    const breaker = new CircuitBreaker('test-dep-6', { failureThreshold: 2, cooldownMs: 5000 })
    const failFn = vi.fn().mockRejectedValue(new Error('down'))

    await breaker.execute(failFn)
    await breaker.execute(failFn) // open

    vi.advanceTimersByTime(5001) // now half-open
    expect(breaker.getState()).toBe('half-open')

    await breaker.execute(failFn) // trial fails
    expect(breaker.getState()).toBe('open')

    // Immediately re-checking: still within the NEW cooldown window.
    const result = await breaker.execute(failFn)
    expect(result.shortCircuited).toBe(true)

    vi.useRealTimers()
  })

  it('getCircuitBreaker returns the same instance for the same dependency key', () => {
    const a = getCircuitBreaker('design-tokens-mcp')
    const b = getCircuitBreaker('design-tokens-mcp')

    expect(a).toBe(b)
  })

  it('getCircuitBreaker returns independent breakers for different dependency keys', async () => {
    const a = getCircuitBreaker('dep-a', { failureThreshold: 1, cooldownMs: 60_000 })
    const b = getCircuitBreaker('dep-b', { failureThreshold: 1, cooldownMs: 60_000 })
    const failFn = vi.fn().mockRejectedValue(new Error('down'))

    await a.execute(failFn)

    expect(a.getState()).toBe('open')
    expect(b.getState()).toBe('closed')
  })

  it('isOpen() reflects short-circuit state without performing a call', async () => {
    const breaker = new CircuitBreaker('test-dep-7', { failureThreshold: 1, cooldownMs: 60_000 })
    const failFn = vi.fn().mockRejectedValue(new Error('down'))

    expect(breaker.isOpen()).toBe(false)

    await breaker.execute(failFn)

    expect(breaker.isOpen()).toBe(true)
  })

  it('resetAllCircuitBreakers clears all registered breaker state (test isolation helper)', async () => {
    const breaker = getCircuitBreaker('dep-reset-test', { failureThreshold: 1, cooldownMs: 60_000 })
    await breaker.execute(vi.fn().mockRejectedValue(new Error('down')))
    expect(breaker.isOpen()).toBe(true)

    resetAllCircuitBreakers()

    const fresh = getCircuitBreaker('dep-reset-test', { failureThreshold: 1, cooldownMs: 60_000 })
    expect(fresh.isOpen()).toBe(false)
  })
})
