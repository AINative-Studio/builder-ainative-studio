import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #443 — /api/primitive/[primitive]/[...path]: the runtime-callable proxy
 * for founder-scoped primitives (ZeroCommerce first). Verifies:
 *  - 404 on an unknown primitive name;
 *  - 401 on a missing/forged token AND no COMPANY_SLUG env var (fail closed);
 *  - a deployed service's COMPANY_SLUG env var is used directly, no token needed;
 *  - a valid preview token resolves the right company;
 *  - an honest 502 (not a crash) when no founder credential was ever stored;
 *  - the real primitive's response is forwarded verbatim, method/body/status included;
 *  - the founder credential is NEVER present in any response sent back.
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  verifyPrimitiveProxyToken: vi.fn(),
  resolveFounderCredential: vi.fn(),
}))

vi.mock('@/lib/build/primitive-proxy-token', () => ({ verifyPrimitiveProxyToken: h.verifyPrimitiveProxyToken }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))

import { GET, POST } from '@/app/api/primitive/[primitive]/[...path]/route'

function req(opts: { method?: string; headers?: Record<string, string>; search?: string; body?: string } = {}) {
  const url = `https://builder.ainative.studio/api/primitive/zerocommerce/commerce/products${opts.search || ''}`
  return {
    method: opts.method || 'GET',
    nextUrl: new URL(url),
    headers: new Headers(opts.headers || {}),
    text: async () => opts.body ?? '',
  } as any
}

function ctx(primitive: string, path: string[]) {
  return { params: Promise.resolve({ primitive, path }) }
}

const origCompanySlug = process.env.COMPANY_SLUG

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.COMPANY_SLUG
})
afterEach(() => {
  if (origCompanySlug === undefined) delete process.env.COMPANY_SLUG
  else process.env.COMPANY_SLUG = origCompanySlug
  vi.unstubAllGlobals()
})

describe('GET/POST /api/primitive/[primitive]/[...path] (#443)', () => {
  it('404s on an unknown primitive name', async () => {
    const res: any = await GET(req(), ctx('unknownthing', ['x']))
    expect(res.status).toBe(404)
  })

  it('401s when no COMPANY_SLUG env var and no token is present (fail closed)', async () => {
    const res: any = await GET(req(), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(401)
    expect(h.resolveFounderCredential).not.toHaveBeenCalled()
  })

  it('401s on a present-but-invalid/forged token', async () => {
    h.verifyPrimitiveProxyToken.mockReturnValue(null)
    const res: any = await GET(req({ headers: { Authorization: 'Bearer forged' } }), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(401)
  })

  it('a deployed service (COMPANY_SLUG env var) is used directly — no token needed', async () => {
    process.env.COMPANY_SLUG = 'acme'
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    await GET(req(), ctx('zerocommerce', ['commerce', 'products']))
    expect(h.resolveFounderCredential).toHaveBeenCalledWith('acme', 'zerocommerce')
    expect(h.verifyPrimitiveProxyToken).not.toHaveBeenCalled()
  })

  it('a valid preview token resolves the right company (no COMPANY_SLUG env var)', async () => {
    h.verifyPrimitiveProxyToken.mockReturnValue({ purpose: 'primitive-proxy-v1', slug: 'coffee-shop', primitive: 'zerocommerce', iat: 1 })
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    await GET(req({ headers: { 'x-ainative-primitive-token': 'sometoken' } }), ctx('zerocommerce', ['commerce', 'products']))
    expect(h.resolveFounderCredential).toHaveBeenCalledWith('coffee-shop', 'zerocommerce')
  })

  it('returns an honest 502 (never a crash) when no founder credential was ever stored', async () => {
    process.env.COMPANY_SLUG = 'acme'
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    const res: any = await GET(req(), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toEqual({ error: 'primitive_unavailable', reason: 'not_provisioned' })
  })

  it('forwards a GET to the real primitive with the resolved Bearer token, and returns its response verbatim', async () => {
    process.env.COMPANY_SLUG = 'acme'
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'real-founder-token' })
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://zerocommerce.ainative.studio/api/v1/commerce/products')
      expect(init.headers.Authorization).toBe('Bearer real-founder-token')
      return { status: 200, text: async () => JSON.stringify({ products: [{ id: '1', name: 'Widget' }] }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await GET(req(), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ products: [{ id: '1', name: 'Widget' }] })
  })

  it('forwards a POST with its body, and never leaks the founder credential in the response', async () => {
    process.env.COMPANY_SLUG = 'acme'
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'super-secret-founder-token' })
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.method).toBe('POST')
      expect(init.body).toBe('{"name":"New Product"}')
      return { status: 201, text: async () => JSON.stringify({ id: '2', name: 'New Product' }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await POST(req({ method: 'POST', body: '{"name":"New Product"}' }), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(201)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('super-secret-founder-token')
  })

  it('returns an honest 502 (never a crash) when the real primitive is unreachable', async () => {
    process.env.COMPANY_SLUG = 'acme'
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET') }))
    const res: any = await GET(req(), ctx('zerocommerce', ['commerce', 'products']))
    expect(res.status).toBe(502)
  })

  describe('zeropipeline (#443 follow-up)', () => {
    it('is a known primitive, routed to the real ZeroPipeline host with the resolved founder token', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'real-pipeline-token' })
      const fetchMock = vi.fn(async (url: string, init: any) => {
        expect(url).toBe('https://pipeline.ainative.studio/api/v1/pipelines')
        expect(init.headers.Authorization).toBe('Bearer real-pipeline-token')
        return { status: 200, text: async () => JSON.stringify({ pipelines: [] }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response
      })
      vi.stubGlobal('fetch', fetchMock)

      const res: any = await GET(req(), ctx('zeropipeline', ['pipelines']))
      expect(res.status).toBe(200)
      expect(h.resolveFounderCredential).toHaveBeenCalledWith('acme', 'zeropipeline')
    })

    it('returns an honest 502 when no founder credential was ever stored', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
      const res: any = await GET(req(), ctx('zeropipeline', ['pipelines']))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json).toEqual({ error: 'primitive_unavailable', reason: 'not_provisioned' })
    })
  })

  describe('AgentFlow (#443 follow-up)', () => {
    function agentflowReq(opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
      return {
        method: opts.method || 'GET',
        nextUrl: new URL('https://builder.ainative.studio/api/primitive/agentflow/projects/'),
        headers: new Headers(opts.headers || {}),
        text: async () => opts.body ?? '',
      } as any
    }

    it('forwards to the real AgentFlow base — /api/v1/projects/, NOT /api/v1/build (live-verified against its openapi.json)', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'af-token' })
      const fetchMock = vi.fn(async (url: string, init: any) => {
        expect(url).toBe('https://agentflow.ainative.studio/api/v1/projects/')
        expect(init.headers.Authorization).toBe('Bearer af-token')
        return { status: 200, text: async () => JSON.stringify({ id: 'proj-1' }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response
      })
      vi.stubGlobal('fetch', fetchMock)

      const res: any = await GET(agentflowReq(), ctx('agentflow', ['projects', '']))
      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('401s on a missing token with no COMPANY_SLUG, same fail-closed behavior as ZeroCommerce', async () => {
      const res: any = await GET(agentflowReq(), ctx('agentflow', ['projects', '']))
      expect(res.status).toBe(401)
      expect(h.resolveFounderCredential).not.toHaveBeenCalled()
    })

    it('502s honestly when no AgentFlow credential was ever stored for this company', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
      const res: any = await GET(agentflowReq(), ctx('agentflow', ['projects', '']))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json).toEqual({ error: 'primitive_unavailable', reason: 'not_provisioned' })
    })
  })

  describe('ZeroForms (#443 follow-up — last of the 4 originally-scoped founder-identity primitives)', () => {
    it('forwards to the real ZeroForms base — /v1/forms, NO /api prefix (live-verified)', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'zf-token' })
      const fetchMock = vi.fn(async (url: string, init: any) => {
        expect(url).toBe('https://zeroforms-production.up.railway.app/v1/forms')
        expect(init.headers.Authorization).toBe('Bearer zf-token')
        return { status: 200, text: async () => JSON.stringify({ forms: [] }), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response
      })
      vi.stubGlobal('fetch', fetchMock)

      const res: any = await GET(req(), ctx('zeroforms', ['forms']))
      expect(res.status).toBe(200)
      expect(h.resolveFounderCredential).toHaveBeenCalledWith('acme', 'zeroforms')
    })

    it('401s on a missing token with no COMPANY_SLUG, same fail-closed behavior as the other primitives', async () => {
      const res: any = await GET(req(), ctx('zeroforms', ['forms']))
      expect(res.status).toBe(401)
      expect(h.resolveFounderCredential).not.toHaveBeenCalled()
    })

    it('502s honestly when no ZeroForms credential was ever stored for this company', async () => {
      process.env.COMPANY_SLUG = 'acme'
      h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
      const res: any = await GET(req(), ctx('zeroforms', ['forms']))
      expect(res.status).toBe(502)
      const json = await res.json()
      expect(json).toEqual({ error: 'primitive_unavailable', reason: 'not_provisioned' })
    })
  })
})
