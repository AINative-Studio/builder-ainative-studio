import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * GET/POST /api/cron/nightly-loop-sequence (#1110).
 *
 * Replaces the GitHub Actions matrix as the nightly loop's trigger. The old
 * matrix fired all 4 shards within <1s of each other, overloading the single
 * Railway instance (up to 32 concurrent per-company pipelines at once) and
 * causing intermittent 502s on 1-2 shards most nights — confirmed live across
 * four separate nights with a different failing shard combination each time.
 *
 * This route calls the 4 shards of /api/build/nightly-loop ONE AT A TIME with
 * a delay between each, so peak concurrent load drops ~4x. A single shard
 * failing must never block the remaining shards (same fail-fast: false
 * contract the old matrix had).
 *
 * The route captures CRON_SECRET/NIGHTLY_LOOP_SHARD_DELAY_MS as module-level
 * consts at import time, so they must be set BEFORE the import executes.
 * vi.hoisted() runs above the (statically-hoisted) import — a plain
 * process.env assignment written textually above the import does NOT work,
 * because ES module imports are hoisted above all other statements.
 */

vi.hoisted(() => {
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.NIGHTLY_LOOP_SHARD_DELAY_MS = '0'
})

import { GET, POST } from '@/app/api/cron/nightly-loop-sequence/route'
import { NextRequest } from 'next/server'

function req(opts: { auth?: string } = {}): NextRequest {
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  return new NextRequest('https://builder.ainative.studio/api/cron/nightly-loop-sequence', { headers })
}

function fetchResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('GET /api/cron/nightly-loop-sequence', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('rejects a request without the correct bearer token', async () => {
    const res = await GET(req({ auth: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('calls all 4 shards sequentially (never more than one in flight) and reports ok:true when all succeed', async () => {
    const callOrder: number[] = []
    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      const shard = Number(new URL(url).searchParams.get('shard'))
      callOrder.push(shard)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return fetchResponse(200, { ok: true, enrolled: 10, processed: 10 })
    })

    const res = await GET(req({ auth: 'Bearer test-cron-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(callOrder).toEqual([0, 1, 2, 3])
    expect(maxInFlight).toBe(1)
    expect(body.shards).toHaveLength(4)
    expect(body.failedShards).toEqual([])
  })

  it('every call targets /api/build/nightly-loop with the matching shard/shards params and the CRON_SECRET bearer token', async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(200, { ok: true }))
    await GET(req({ auth: 'Bearer test-cron-secret' }))

    expect(fetch).toHaveBeenCalledTimes(4)
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).toContain('/api/build/nightly-loop?shard=')
      expect(String(url)).toContain('shards=4')
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-cron-secret' })
    }
  })

  it('one failing shard does not block the remaining shards, and is reported in failedShards', async () => {
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      const shard = Number(new URL(url).searchParams.get('shard'))
      if (shard === 2) return fetchResponse(502, { error: 'upstream error' })
      return fetchResponse(200, { ok: true })
    })

    const res = await GET(req({ auth: 'Bearer test-cron-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.failedShards).toEqual([2])
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('a shard that throws (network error / timeout) is recorded as a failure, not an unhandled rejection', async () => {
    vi.mocked(fetch).mockImplementation(async (url: any) => {
      const shard = Number(new URL(url).searchParams.get('shard'))
      if (shard === 1) throw new Error('fetch failed')
      return fetchResponse(200, { ok: true })
    })

    const res = await GET(req({ auth: 'Bearer test-cron-secret' }))
    const body = await res.json()

    expect(body.failedShards).toEqual([1])
    expect(body.shards[1].error).toBe('fetch failed')
  })

  it('POST delegates to GET, same convention as the other /api/cron/* routes', async () => {
    vi.mocked(fetch).mockResolvedValue(fetchResponse(200, { ok: true }))
    const res = await POST(req({ auth: 'Bearer test-cron-secret' }))
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
