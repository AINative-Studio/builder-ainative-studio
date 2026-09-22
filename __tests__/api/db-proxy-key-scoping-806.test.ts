import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #806/#844 — /api/db/{table} must use the key actually SCOPED to the project
 * it is talking to.
 *
 * The bug (confirmed live against production on BOTH read and write): every
 * GET/POST/PUT/DELETE here used one shared, service-wide ZERODB_API_KEY even
 * when the signed per-app data token resolved a COMPANY'S OWN ZeroDB project.
 * ZeroDB answered:
 *   403 {"error_code":"API_KEY_PROJECT_MISMATCH"}
 * The generated app's own codegen pattern (`await fetch(...).catch(() => {});
 * setSubmitted(true)`) swallowed it, so a real founder's real waitlist signup
 * showed "You're on the list." and was never persisted anywhere.
 *
 * Invariants under test:
 *  (a) a company WITH a stored per-project key uses THAT key,
 *  (b) a company WITHOUT one fails CLOSED with a clear reason — never a silent
 *      fallback to the shared key (that IS the cross-tenant mis-scoping bug),
 *  (c) the shared/legacy no-token path is unchanged and still uses the shared key.
 */

const h = vi.hoisted(() => ({
  resolveCompanyZerodbKey: vi.fn(),
}))

vi.mock('@/lib/build/company-zerodb-credentials', () => ({
  resolveCompanyZerodbKey: h.resolveCompanyZerodbKey,
}))

process.env.AUTH_SECRET = 'test-secret-for-token-signing'

import { GET, POST } from '@/app/api/db/[table]/route'
import { mintAppDataToken } from '@/lib/build/app-data-token'

/** The route resolves this at module load; mirror its own resolution exactly so
 *  the shared-path assertions test real behavior, not env-ordering luck. */
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
/** Same for the shared key — whatever the route itself resolved at load. The
 *  assertions that matter are RELATIVE (company key used / shared key NOT used
 *  against a per-company project), not the literal value of a real env secret. */
const SHARED_API_KEY = process.env.ZERODB_API_KEY || ''

const COMPANY_PROJECT = 'company-own-project-uuid'
const companyToken = () => mintAppDataToken(COMPANY_PROJECT, 'acme', Math.floor(Date.now() / 1000))

type FetchCall = [unknown, { headers?: Record<string, string> } | undefined]

function req(url: string, opts: { token?: string; body?: any } = {}) {
  const nextUrl = new URL(url)
  const headers = new Map<string, string>()
  if (opts.token) headers.set('x-ainative-db-token', opts.token)
  return {
    nextUrl,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => opts.body ?? {},
  } as any
}

const params = (table: string) => ({ params: Promise.resolve({ table }) })

/** Every X-API-Key actually sent to ZeroDB by the code under test. */
function keysUsed(fetchMock: any): string[] {
  return (fetchMock.mock.calls as FetchCall[]).map((c) => c[1]?.headers?.['X-API-Key'] as string)
}

/** All URLs the code under test actually called, in order. */
function urlsCalled(fetchMock: any): string[] {
  return (fetchMock.mock.calls as FetchCall[]).map((c) => String(c[0]))
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/db/{table} — key scoping (#806)', () => {
  it('(a) a company WITH a stored per-project key queries its own project with THAT key', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_company_scoped_key' })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await GET(req('http://x/api/db/waitlist', { token: companyToken() }), params('waitlist'))
    expect(res.status).toBe(200)
    expect(h.resolveCompanyZerodbKey).toHaveBeenCalledWith(COMPANY_PROJECT)
    expect(urlsCalled(fetchMock)[0]).toContain(`/projects/${COMPANY_PROJECT}/`)
    expect(keysUsed(fetchMock)).toEqual(['sk_company_scoped_key'])
    // The shared key must never be used against a per-company project.
    expect(keysUsed(fetchMock)).not.toContain(SHARED_API_KEY)
  })

  it('(b) a company WITHOUT a stored key FAILS CLOSED — no ZeroDB call, no shared-key fallback', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await GET(req('http://x/api/db/waitlist', { token: companyToken() }), params('waitlist'))
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.reason).toBe('not_stored')
    // The critical assertion: it never tried anyway with the wrong key.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(b2) a decrypt failure also fails closed, with its own reason', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'decrypt_failed' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res: any = await GET(req('http://x/api/db/waitlist', { token: companyToken() }), params('waitlist'))
    expect(res.status).toBe(502)
    expect((await res.json()).reason).toBe('decrypt_failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(c) the legacy no-token path is UNCHANGED: shared project, shared key, no key lookup', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await GET(req('http://x/api/db/visitors'), params('visitors'))
    expect(res.status).toBe(200)
    expect(h.resolveCompanyZerodbKey).not.toHaveBeenCalled()
    expect(urlsCalled(fetchMock)[0]).toContain(`/projects/${SHARED_PROJECT_ID}/`)
    expect(keysUsed(fetchMock)).toEqual([SHARED_API_KEY])
  })

  it('a token naming the SHARED project still uses the shared key (it is scoped to it)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const token = mintAppDataToken(SHARED_PROJECT_ID, 'legacy', Math.floor(Date.now() / 1000))
    const res: any = await GET(req('http://x/api/db/visitors', { token }), params('visitors'))
    expect(res.status).toBe(200)
    expect(h.resolveCompanyZerodbKey).not.toHaveBeenCalled()
    expect(keysUsed(fetchMock)).toEqual([SHARED_API_KEY])
  })

  it('a forged token still FAILS CLOSED with 401 (#331 unchanged) before any key lookup', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res: any = await GET(req('http://x/api/db/waitlist', { token: 'not.a.valid.token' }), params('waitlist'))
    expect(res.status).toBe(401)
    expect(h.resolveCompanyZerodbKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/db/{table} — the real waitlist write path (#844)', () => {
  it('THE BUG: a real waitlist signup now writes with the company-scoped key, not the shared one', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'sk_company_scoped_key' })
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ row_id: 'r1', row_data: { email: 'a@b.co' } }) }))
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.co', joinedAt: 'now' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(200)
    // Both the ensureTable call and the insert must carry the scoped key.
    const used = keysUsed(fetchMock)
    expect(used.length).toBeGreaterThanOrEqual(2)
    expect(new Set(used)).toEqual(new Set(['sk_company_scoped_key']))
    expect(used).not.toContain(SHARED_API_KEY)
    const insertUrl = urlsCalled(fetchMock).find((u) => u.includes('/rows'))
    expect(insertUrl).toContain(`/projects/${COMPANY_PROJECT}/`)
  })

  it('a write for a company with NO stored key fails closed — it must NOT silently create a table or row', async () => {
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res: any = await POST(
      req('http://x/api/db/waitlist', { token: companyToken(), body: { email: 'a@b.co' } }),
      params('waitlist'),
    )
    expect(res.status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
