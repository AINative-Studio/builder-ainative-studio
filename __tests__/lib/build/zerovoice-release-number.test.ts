import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('releaseZeroVoiceNumber', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls DELETE on the real numbers endpoint with the founder JWT', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) })
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_abc123')
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/numbers/num_abc123'),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer real-jwt-token' }),
      }),
    )
  })

  it('reports the real reason on a non-2xx response, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'number not found' }) })
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_missing')
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.reason).toContain('number not found')
  })

  it('fails closed on a network error, never throws past the caller', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('real-jwt-token', 'num_abc123')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('ECONNRESET')
  })

  it('returns ok:false with reason "no_jwt" when no JWT is given, without calling fetch', async () => {
    const { releaseZeroVoiceNumber } = await import('@/lib/build/zerovoice')
    const result = await releaseZeroVoiceNumber('', 'num_abc123')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_jwt')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
