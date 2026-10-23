import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — the four deploy-provider webhook handlers
 * (ainative, netlify, railway, vercel) had zero route-level test coverage.
 * Each is a tiny, near-identical pattern: parse the provider's payload, map
 * its provider-specific status string onto our internal `deployments.status`
 * enum via a local switch, persist via drizzle, and 200 `{ received: true }`
 * — or 500 on any throw. Vercel additionally HMAC-verifies the payload before
 * touching it, so its own test file covers that extra branch.
 *
 * `lib/db` is mocked as a minimal chainable query builder (same shape used
 * elsewhere in this suite, e.g. admin-template-submissions-route-919.test.ts)
 * so no real DB/network call ever happens.
 */

const h = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn((..._args: any[]) => Promise.resolve(undefined)),
}))

vi.mock('@/lib/db', () => {
  const chain: any = {
    update: (...args: any[]) => {
      h.update(...args)
      return chain
    },
    set: (...args: any[]) => {
      h.set(...args)
      return chain
    },
    where: (...args: any[]) => h.where(...args),
  }
  return { db: chain }
})

vi.mock('@/lib/db/schema', () => ({ deployments: { deployment_id: 'deployment_id' } }))

import { mockJsonRequest, mockTextRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
  h.where.mockImplementation(() => Promise.resolve(undefined))
})

describe('#1202 POST /api/webhooks/ainative', () => {
  it('maps a ready/deployed status, persists url + provider metadata, and 200s', async () => {
    const { POST } = await import('@/app/api/webhooks/ainative/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/ainative', {
      deploymentId: 'dep-1',
      status: 'deployed',
      url: 'https://example.ainative.studio',
      provider: 'railway',
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(h.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', url: 'https://example.ainative.studio' })
    )
  })

  it.each([
    ['building', 'building'],
    ['deploying', 'building'],
    ['error', 'error'],
    ['failed', 'error'],
    ['queued', 'pending'],
  ])('maps provider status "%s" to internal status "%s"', async (input, expected) => {
    const { POST } = await import('@/app/api/webhooks/ainative/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/ainative', {
      deploymentId: 'dep-1',
      status: input,
    })

    await POST(req)

    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ status: expected }))
  })

  it('returns 500 (not a crash) when the DB update throws', async () => {
    h.where.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const { POST } = await import('@/app/api/webhooks/ainative/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/ainative', {
      deploymentId: 'dep-1',
      status: 'ready',
    })

    const res = await POST(req)

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeDefined()
  })

  it('returns 500 when the body is not valid JSON', async () => {
    const { POST } = await import('@/app/api/webhooks/ainative/route')
    const req = mockTextRequest('http://localhost/api/webhooks/ainative', '{not json')

    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/webhooks/netlify', () => {
  it('maps ready state, persists ssl_url as url, and 200s', async () => {
    const { POST } = await import('@/app/api/webhooks/netlify/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/netlify', {
      id: 'dep-2',
      state: 'ready',
      ssl_url: 'https://foo.netlify.app',
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', url: 'https://foo.netlify.app' })
    )
  })

  it.each([
    ['processing', 'building'],
    ['building', 'building'],
    ['error', 'error'],
    ['new', 'pending'],
  ])('maps provider state "%s" to internal status "%s"', async (input, expected) => {
    const { POST } = await import('@/app/api/webhooks/netlify/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/netlify', { id: 'dep-2', state: input })

    await POST(req)

    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ status: expected }))
  })

  it('returns 500 when the DB update throws', async () => {
    h.where.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const { POST } = await import('@/app/api/webhooks/netlify/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/netlify', { id: 'dep-2', state: 'ready' })

    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/webhooks/railway', () => {
  it('maps SUCCESS/ACTIVE (case-insensitively) to ready and 200s', async () => {
    const { POST } = await import('@/app/api/webhooks/railway/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/railway', {
      deploymentId: 'dep-3',
      status: 'SUCCESS',
      url: 'https://foo.up.railway.app',
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
  })

  it.each([
    ['BUILDING', 'building'],
    ['DEPLOYING', 'building'],
    ['FAILED', 'error'],
    ['CRASHED', 'error'],
    ['INITIALIZING', 'pending'],
  ])('maps provider status "%s" to internal status "%s"', async (input, expected) => {
    const { POST } = await import('@/app/api/webhooks/railway/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/railway', {
      deploymentId: 'dep-3',
      status: input,
    })

    await POST(req)

    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ status: expected }))
  })

  it('returns 500 when the DB update throws', async () => {
    h.where.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const { POST } = await import('@/app/api/webhooks/railway/route')
    const req = mockJsonRequest('http://localhost/api/webhooks/railway', {
      deploymentId: 'dep-3',
      status: 'SUCCESS',
    })

    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/webhooks/vercel', () => {
  const ORIGINAL_SECRET = process.env.VERCEL_WEBHOOK_SECRET

  beforeEach(() => {
    process.env.VERCEL_WEBHOOK_SECRET = 'test-secret'
  })

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.VERCEL_WEBHOOK_SECRET
    else process.env.VERCEL_WEBHOOK_SECRET = ORIGINAL_SECRET
  })

  function signedPayload(payload: object) {
    const { createHmac } = require('crypto')
    const text = JSON.stringify(payload)
    const signature = createHmac('sha256', 'test-secret').update(text).digest('hex')
    return { text, signature }
  }

  it('rejects with 401 when no signature header is present', async () => {
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', JSON.stringify({ deploymentId: 'd' }))

    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the signature does not verify', async () => {
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', JSON.stringify({ deploymentId: 'd' }), {
      headers: { 'x-vercel-signature': 'deadbeef'.repeat(8) },
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('rejects with 401 when VERCEL_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.VERCEL_WEBHOOK_SECRET
    const { text, signature } = signedPayload({ deploymentId: 'd4', readyState: 'READY' })
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', text, {
      headers: { 'x-vercel-signature': signature },
    })

    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('accepts a correctly signed payload, maps READY, and prefixes url with https://', async () => {
    const { text, signature } = signedPayload({
      deploymentId: 'dep-4',
      readyState: 'READY',
      url: 'foo.vercel.app',
    })
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', text, {
      headers: { 'x-vercel-signature': signature },
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(h.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', url: 'https://foo.vercel.app' })
    )
  })

  it.each([
    ['BUILDING', 'building'],
    ['QUEUED', 'building'],
    ['ERROR', 'error'],
    ['CANCELED', 'error'],
    ['INITIALIZING', 'pending'],
  ])('maps provider readyState "%s" to internal status "%s"', async (input, expected) => {
    const { text, signature } = signedPayload({ deploymentId: 'dep-4', readyState: input })
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', text, {
      headers: { 'x-vercel-signature': signature },
    })

    await POST(req)

    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ status: expected }))
  })

  it('returns 500 when a verified payload fails downstream (DB throws)', async () => {
    h.where.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const { text, signature } = signedPayload({ deploymentId: 'dep-4', readyState: 'READY' })
    const { POST } = await import('@/app/api/webhooks/vercel/route')
    const req = mockTextRequest('http://localhost/api/webhooks/vercel', text, {
      headers: { 'x-vercel-signature': signature },
    })

    const res = await POST(req)

    expect(res.status).toBe(500)
  })
})
