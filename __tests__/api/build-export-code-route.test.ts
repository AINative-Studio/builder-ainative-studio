import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1187 — /api/build/export-code: downloads the company's REAL app source
 * as a ZIP (distinct from /api/build/export, #63.C, which exports the
 * company's ZeroDB DATA). Same owner-only auth invariants as the data export
 * route, verified independently here since this is a new, separate route.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  resolveStoredApp: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', async (orig) => {
  const actual = await (orig as any)()
  return {
    ...actual,
    resolveAppVerified: (slug: string) => h.resolveApp(slug).then((entry: any) => ({ entry, verified: true })),
  }
})
vi.mock('@/lib/build/ready-gate', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, resolveStoredApp: h.resolveStoredApp }
})
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { GET, POST } from '@/app/api/build/export-code/route'

const OWNER = 'ada@x.com'
const REAL = { user: { email: OWNER, type: 'ainative' } }
const GUEST = { user: { email: 'guest-1@example.com', type: 'guest' } }
const OTHER = { user: { email: 'mallory@x.com', type: 'ainative' } }

const OWNED_APP = { slug: 'acme', chatId: 'chat-1', name: 'Acme', ownerEmail: OWNER }

function urlReq(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) } } as any
}
function bodyReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as any).mockReset?.())
  h.resolveApp.mockResolvedValue(OWNED_APP)
  h.resolveStoredApp.mockResolvedValue({
    code: 'export default function App() { return null }',
    files: { '/App.tsx': 'export default function App() { return null }' },
  })
})

describe('GET /api/build/export-code', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(401)
    expect(h.resolveStoredApp).not.toHaveBeenCalled()
  })

  it('401 for a guest session', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(401)
  })

  it('400 when companyId is missing', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await GET(urlReq(''))
    expect(res.status).toBe(400)
  })

  it('404 when the company does not resolve', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue(null)
    const res = await GET(urlReq('companyId=nope'))
    expect(res.status).toBe(404)
  })

  // #832-class bug: a transient registry-read failure must never look like
  // a confirmed "company not found" and block a real owner's code export.
  it('503s with lookup_failed (never a false "company not found") on an unverified registry read', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockRejectedValue(new Error('registry timeout'))
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('lookup_failed')
    expect(h.resolveStoredApp).not.toHaveBeenCalled()
  })

  it('403 when the signed-in user does not own the company', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(403)
    expect(h.resolveStoredApp).not.toHaveBeenCalled()
  })

  it('400 when the company has no chatId / generated app', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue({ ...OWNED_APP, chatId: undefined })
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(400)
  })

  it('404 when no stored code exists yet', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveStoredApp.mockResolvedValue(null)
    const res = await GET(urlReq('companyId=acme'))
    expect(res.status).toBe(404)
  })

  it('200 returns a real ZIP attachment with the right headers', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await GET(urlReq('companyId=acme'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    const cd = res.headers.get('Content-Disposition') || ''
    expect(cd).toContain('attachment')
    expect(cd).toContain('.zip')

    const bytes = new Uint8Array(await res.arrayBuffer())
    // A real ZIP's local-file-header magic number: 'PK\x03\x04'.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  it('accepts ?slug= as an alias for companyId', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await GET(urlReq('slug=acme'))
    expect(res.status).toBe(200)
    expect(h.resolveApp).toHaveBeenCalledWith('acme')
  })
})

describe('POST /api/build/export-code', () => {
  it('behaves identically to GET for a JSON body caller', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await POST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
  })

  it('403 when the signed-in user does not own the company', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await POST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(403)
  })
})
