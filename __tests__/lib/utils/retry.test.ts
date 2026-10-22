import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry, withAuthRetry } from '@/lib/utils/retry'

describe('lib/utils/retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('withRetry', () => {
    it('returns the result on the first successful attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('ok')

      const result = await withRetry(fn)

      expect(result).toBe('ok')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries a Response with status 429 and eventually succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10, maxDelayMs: 100 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('isRetryableError recognizes a real Response instance with status 429/502/503/504 - forced by retryOn: () => false so the || must evaluate isRetryableError, not short-circuit on the default', async () => {
      for (const status of [429, 502, 503, 504]) {
        const fn = vi
          .fn()
          .mockRejectedValueOnce(new Response(null, { status }))
          .mockResolvedValueOnce(`recovered-${status}`)

        const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })
        await vi.runAllTimersAsync()

        await expect(promise).resolves.toBe(`recovered-${status}`)
        expect(fn).toHaveBeenCalledTimes(2)
      }
    })

    it('isRetryableError rejects an unrelated Response status (e.g. 418) when retryOn also rejects it, so no retry happens', async () => {
      const fn = vi.fn().mockRejectedValue(new Response(null, { status: 418 }))

      const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })

      await expect(promise).rejects.toBeInstanceOf(Response)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('a non-5xx/429 Response IS still retried under the default retryOn (() => true), even though isRetryableError alone would reject it', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Response(null, { status: 418 }))
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
    })

    it('isRetryableError recognizes a 502/503/504-shaped plain object with a status field (retryOn forced false so isRetryableError must decide)', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('isRetryableError rejects a status-shaped object whose status is not 429/502/503/504', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 200 })

      const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })

      await expect(promise).rejects.toEqual({ status: 200 })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('isRetryableError recognizes a network TypeError mentioning fetch (retryOn forced false)', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('isRetryableError rejects a TypeError unrelated to fetch', async () => {
      const fn = vi.fn().mockRejectedValue(new TypeError('cannot read properties of undefined'))

      const promise = withRetry(fn, { initialDelayMs: 10, retryOn: () => false })

      await expect(promise).rejects.toThrow('cannot read properties of undefined')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('a 502/503/504-shaped error object is still retried under the default retryOn', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 503 })
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('a network TypeError is still retried under the default retryOn', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce('recovered')

      const promise = withRetry(fn, { initialDelayMs: 10 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('recovered')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('does not retry when retryOn explicitly rejects the error (default retryOn is always true, so this requires overriding it)', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('totally unrelated'))

      await expect(
        withRetry(fn, { maxRetries: 3, initialDelayMs: 10, retryOn: () => false }),
      ).rejects.toThrow('totally unrelated')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('retries a plain Error by default, since the built-in retryOn always returns true', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce('ok')

      const promise = withRetry(fn, { initialDelayMs: 10 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('throws after exhausting maxRetries even for a retryable error', async () => {
      const err = { status: 500 }
      const fn = vi.fn().mockRejectedValue(err)

      const promise = withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })
      const assertion = expect(promise).rejects.toBe(err)
      await vi.runAllTimersAsync()
      await assertion

      expect(fn).toHaveBeenCalledTimes(3) // attempts 0, 1, 2
    })

    it('honors a custom retryOn predicate', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('custom-retryable'))
        .mockResolvedValueOnce('ok')

      const promise = withRetry(fn, {
        initialDelayMs: 10,
        retryOn: (err) => err instanceof Error && err.message === 'custom-retryable',
      })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('respects a Retry-After header on a 429 Response over the computed backoff delay', async () => {
      const headers = new Headers({ 'Retry-After': '5' })
      const response = new Response(null, { status: 429, headers })
      const fn = vi.fn().mockRejectedValueOnce(response).mockResolvedValueOnce('ok')

      const promise = withRetry(fn, { initialDelayMs: 1000 })

      // Advance by exactly the Retry-After duration (5s), not the much
      // longer exponential-backoff delay that would otherwise apply.
      await vi.advanceTimersByTimeAsync(5000)

      await expect(promise).resolves.toBe('ok')
    })

    it('caps the exponential backoff delay at maxDelayMs', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 500 })
        .mockRejectedValueOnce({ status: 500 })
        .mockRejectedValueOnce({ status: 500 })
        .mockResolvedValueOnce('ok')

      const promise = withRetry(fn, { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 1500 })
      await vi.runAllTimersAsync()

      await expect(promise).resolves.toBe('ok')
      expect(fn).toHaveBeenCalledTimes(4)
    })

    it('uses default options (3 retries, 1000ms initial delay) when none are given', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 500 })

      const promise = withRetry(fn)
      const assertion = expect(promise).rejects.toMatchObject({ status: 500 })
      await vi.runAllTimersAsync()
      await assertion

      expect(fn).toHaveBeenCalledTimes(4) // default maxRetries: 3 -> 4 attempts
    })
  })

  describe('withAuthRetry', () => {
    it('returns the result directly when fn succeeds on the first try', async () => {
      const fn = vi.fn().mockResolvedValue('ok')
      const refreshFn = vi.fn().mockResolvedValue(undefined)

      const result = await withAuthRetry(fn, refreshFn)

      expect(result).toBe('ok')
      expect(refreshFn).not.toHaveBeenCalled()
    })

    it('refreshes and retries once on a 401 Response, then returns the retried result', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce('ok-after-refresh')
      const refreshFn = vi.fn().mockResolvedValue(undefined)

      const result = await withAuthRetry(fn, refreshFn)

      expect(result).toBe('ok-after-refresh')
      expect(refreshFn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('refreshes and retries once on a 401-shaped error object', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce({ status: 401 })
        .mockResolvedValueOnce('ok-after-refresh')
      const refreshFn = vi.fn().mockResolvedValue(undefined)

      const result = await withAuthRetry(fn, refreshFn)

      expect(result).toBe('ok-after-refresh')
      expect(refreshFn).toHaveBeenCalledTimes(1)
    })

    it('rethrows immediately for a non-401 error without calling refreshFn', async () => {
      const err = new Error('server exploded')
      const fn = vi.fn().mockRejectedValue(err)
      const refreshFn = vi.fn().mockResolvedValue(undefined)

      await expect(withAuthRetry(fn, refreshFn)).rejects.toBe(err)
      expect(refreshFn).not.toHaveBeenCalled()
    })

    it('propagates the retried call failure if it fails again after refresh', async () => {
      const secondError = new Error('still unauthorized')
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Response(null, { status: 401 }))
        .mockRejectedValueOnce(secondError)
      const refreshFn = vi.fn().mockResolvedValue(undefined)

      await expect(withAuthRetry(fn, refreshFn)).rejects.toBe(secondError)
      expect(refreshFn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledTimes(2)
    })

    it('propagates a refreshFn failure without calling fn a second time', async () => {
      const refreshError = new Error('refresh failed')
      const fn = vi.fn().mockRejectedValueOnce(new Response(null, { status: 401 }))
      const refreshFn = vi.fn().mockRejectedValue(refreshError)

      await expect(withAuthRetry(fn, refreshFn)).rejects.toBe(refreshError)
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})
