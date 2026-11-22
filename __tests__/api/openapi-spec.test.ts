import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/openapi.json/route'

const REAL_X402_PLANS_RESPONSE = {
  success: true,
  data: {
    plans: [
      { id: 'hobbyist', name: 'Hobbyist', amount: 500, pay_to: '0x5631a4d7516da6bc2712f91dc8489637b87e2f52', network: 'circle' },
      { id: 'pro', name: 'Pro', amount: 4900, pay_to: '0x5631a4d7516da6bc2712f91dc8489637b87e2f52', network: 'circle' },
    ],
  },
}

// #2216 — none of these tests should depend on the real network. The x402
// crosshost annotation fetches a live core endpoint, so it's mocked here the
// same way every other fetch-dependent module in this suite is.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => REAL_X402_PLANS_RESPONSE,
  })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /openapi.json (AX/agent-readiness scan, 2026-09-30)', () => {
  it('returns a valid OpenAPI 3.1 document', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const spec = await res.json()
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info?.title).toBeTruthy()
  })

  it('only documents routes this codebase itself already marks as agent-facing', async () => {
    const res = await GET()
    const spec = await res.json()
    const paths = Object.keys(spec.paths)
    // Real, already-agent-callable routes (per public/llms.txt + "AX: agent-accessible" doc comments).
    for (const p of ['/api/health', '/api/chat-ws', '/api/build/artifact', '/api/build/ask', '/api/build/systems', '/api/preview/{chatId}', '/api/build/enroll', '/api/build/provision', '/api/build/secrets', '/api/build/redeploy', '/api/build/deck']) {
      expect(paths).toContain(p)
    }
  })

  it('declares a real security scheme pointing at core\'s actual OAuth endpoints, not a fabricated one', async () => {
    const res = await GET()
    const spec = await res.json()
    const scheme = spec.components?.securitySchemes?.sessionCookie
    expect(scheme?.flows?.authorizationCode?.authorizationUrl).toBe('https://api.ainative.studio/oauth/authorize')
    expect(scheme?.flows?.authorizationCode?.tokenUrl).toBe('https://api.ainative.studio/v1/oauth/token')
  })

  it('declares scoped permissions machine-readably on the security scheme', async () => {
    const res = await GET()
    const spec = await res.json()
    const scopes = spec.components?.securitySchemes?.sessionCookie?.flows?.authorizationCode?.scopes
    expect(scopes).toMatchObject({ openid: expect.any(String), profile: expect.any(String), email: expect.any(String) })
  })

  it('documents the real ACP checkout/delegate-payment operations (#2173/#2171)', async () => {
    const res = await GET()
    const spec = await res.json()
    expect(spec.paths['/checkout_sessions']?.post).toBeTruthy()
    expect(spec.paths['/agentic_commerce/delegate_payment']?.post).toBeTruthy()
  })

  it('carries MPP x-service-info and x-payment-info on the checkout operation when ACP signing is configured (#2171)', async () => {
    const originalSecret = process.env.ACP_SIGNING_SECRET
    process.env.ACP_SIGNING_SECRET = 'test-secret'
    try {
      const res = await GET()
      const spec = await res.json()
      expect(spec['x-service-info']).toBeTruthy()
      const paymentInfo = spec.paths['/checkout_sessions']?.post?.['x-payment-info']
      expect(paymentInfo?.offers?.length).toBeGreaterThan(0)
    } finally {
      process.env.ACP_SIGNING_SECRET = originalSecret
    }
  })

  it('never mutates the shared spec across requests — each GET call is independent', async () => {
    const originalSecret = process.env.ACP_SIGNING_SECRET
    try {
      process.env.ACP_SIGNING_SECRET = 'test-secret'
      const withMpp = await (await GET()).json()
      expect(withMpp['x-service-info']).toBeTruthy()

      delete process.env.ACP_SIGNING_SECRET
      const withoutMpp = await (await GET()).json()
      expect(withoutMpp['x-service-info']).toBeUndefined()
    } finally {
      process.env.ACP_SIGNING_SECRET = originalSecret
    }
  })
})

/**
 * #2216 — MPP challenge-half cross-host fix: core's real checker only
 * cross-host-probes an x-payment-info-annotated operation when
 * servers[0].url is a genuinely different origin than the scanned base
 * URL, and it reads index 0 specifically.
 */
describe('GET /openapi.json — x402 cross-host MPP challenge (#2216)', () => {
  it('declares api.ainative.studio as servers[0] and builder.ainative.studio as servers[1]', async () => {
    const spec = await (await GET()).json()
    expect(spec.servers?.[0]?.url).toBe('https://api.ainative.studio')
    expect(spec.servers?.[1]?.url).toBe('https://builder.ainative.studio')
  })

  it('annotates the real x402 subscribe path with offers carrying the required plan_id field', async () => {
    const spec = await (await GET()).json()
    const op = spec.paths['/api/v1/cloud/x402/subscriptions/subscribe']?.post
    expect(op).toBeTruthy()
    const offers = op['x-payment-info']?.offers
    expect(offers?.length).toBeGreaterThan(0)
    for (const offer of offers) {
      expect(offer.plan_id).toBeTruthy()
      expect(offer.amount).toBeTruthy()
      expect(offer.pay_to).toBeTruthy()
      expect(offer.method).toBe('x402')
    }
  })

  it('the x402 operation requires plan_id as a real body field a generic probe can satisfy', async () => {
    const spec = await (await GET()).json()
    const op = spec.paths['/api/v1/cloud/x402/subscriptions/subscribe']?.post
    const required = op?.requestBody?.content?.['application/json']?.schema?.required
    expect(required).toContain('plan_id')
  })

  it('every OTHER operation carries its own explicit servers override pointing at builder.ainative.studio', async () => {
    const spec = await (await GET()).json()
    for (const [path, operations] of Object.entries<any>(spec.paths)) {
      if (path === '/api/v1/cloud/x402/subscriptions/subscribe') continue
      for (const operation of Object.values<any>(operations)) {
        expect(operation.servers).toEqual([{ url: 'https://builder.ainative.studio' }])
      }
    }
  })

  it('the x402 operation keeps its OWN servers override pointing at api.ainative.studio, not the default', async () => {
    const spec = await (await GET()).json()
    const op = spec.paths['/api/v1/cloud/x402/subscriptions/subscribe']?.post
    expect(op.servers).toEqual([{ url: 'https://api.ainative.studio' }])
  })

  it('degrades honestly — no offers advertised when core\'s plans endpoint is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const spec = await (await GET()).json()
    const op = spec.paths['/api/v1/cloud/x402/subscriptions/subscribe']?.post
    expect(op['x-payment-info']).toBeUndefined()
  })

  it('never fabricates an offer when core returns a malformed plans response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: {} }) })))
    const spec = await (await GET()).json()
    const op = spec.paths['/api/v1/cloud/x402/subscriptions/subscribe']?.post
    expect(op['x-payment-info']).toBeUndefined()
  })
})
