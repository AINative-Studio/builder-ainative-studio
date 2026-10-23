import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { refreshAINativeToken, maybeRefreshToken } from '@/lib/auth/tokenRefresh'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * shouldRefreshToken (#792) already has dedicated tests. refreshAINativeToken
 * and maybeRefreshToken — the bulk of this file, including the exponential
 * backoff retry loop — had zero coverage. We mock fetch and use fake timers
 * to drive the retry delays deterministically instead of waiting on real
 * setTimeout backoff (1s/2s/4s would make this suite slow and flaky).
 */
describe('#1201 lib/auth/tokenRefresh — refreshAINativeToken & maybeRefreshToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('refreshAINativeToken', () => {
    it('returns the new tokens on a successful refresh, using the default API URL', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      } as Response)

      const result = await refreshAINativeToken('old-refresh')

      expect(result).toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 3600,
      })
      expect(fetch).toHaveBeenCalledWith(
        'https://api.ainative.studio/api/v1/auth/refresh',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: 'old-refresh' }),
        })
      )
    })

    it('uses a caller-supplied apiUrl override instead of the default', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'a', expires_in: 10 }),
      } as Response)

      await refreshAINativeToken('rt', 'https://custom.example.com')

      expect(fetch).toHaveBeenCalledWith(
        'https://custom.example.com/api/v1/auth/refresh',
        expect.anything()
      )
    })

    it('returns null immediately on a 401 without retrying (refresh token is unrecoverable)', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response)

      const result = await refreshAINativeToken('dead-refresh')

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('retries with exponential backoff on a non-401 failure, then succeeds', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'recovered', expires_in: 60 }),
        } as Response)

      const promise = refreshAINativeToken('rt')
      // First attempt fails synchronously inside the loop; let the 1s backoff elapse.
      await vi.advanceTimersByTimeAsync(1000)
      const result = await promise

      expect(result).toEqual({
        accessToken: 'recovered',
        refreshToken: undefined,
        expiresIn: 60,
      })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('exhausts all retries and returns null, logging the final error', async () => {
      vi.useFakeTimers()
      vi.mocked(fetch).mockRejectedValue(new Error('network unreachable'))

      const promise = refreshAINativeToken('rt')
      // 3 attempts total: delays of 1000ms then 2000ms between them.
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      const result = await promise

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(console.error).toHaveBeenCalledWith(
        '[token-refresh] All retries exhausted:',
        expect.any(Error)
      )
    })
  })

  describe('maybeRefreshToken', () => {
    it('returns the original token unchanged when no refresh is needed', async () => {
      const token = {
        accessToken: 'still-good',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }

      const result = await maybeRefreshToken(token)

      expect(result).toBe(token)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('returns the original token unchanged when a refresh is needed but no refreshToken exists', async () => {
      const token = { accessToken: 'stale', expiresAt: Date.now() - 1000 }

      const result = await maybeRefreshToken(token)

      expect(result).toBe(token)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('keeps the existing token when the refresh attempt fails outright', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response)
      const token = { accessToken: 'stale', refreshToken: 'rt', expiresAt: Date.now() - 1000 }

      const result = await maybeRefreshToken(token)

      expect(result).toBe(token)
    })

    it('returns updated token info with a new expiresAt on a successful refresh', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'fresh-access',
          refresh_token: 'fresh-refresh',
          expires_in: 3600,
        }),
      } as Response)
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const token = { accessToken: 'stale', refreshToken: 'rt', expiresAt: now - 1000 }

      const result = await maybeRefreshToken(token)

      expect(result).toEqual({
        accessToken: 'fresh-access',
        refreshToken: 'fresh-refresh',
        expiresAt: now + 3600 * 1000,
      })
    })

    it('falls back to the prior refreshToken when the response omits one', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh-access', expires_in: 60 }),
      } as Response)
      const token = { accessToken: 'stale', refreshToken: 'original-rt', expiresAt: Date.now() - 1000 }

      const result = await maybeRefreshToken(token)

      expect(result.refreshToken).toBe('original-rt')
    })

    it('keeps the prior expiresAt when the refresh response omits expires_in', async () => {
      const priorExpiresAt = Date.now() - 1000
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh-access' }),
      } as Response)
      const token = { accessToken: 'stale', refreshToken: 'rt', expiresAt: priorExpiresAt }

      const result = await maybeRefreshToken(token)

      expect(result.expiresAt).toBe(priorExpiresAt)
    })
  })
})
