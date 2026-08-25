import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #69 — /api/build/deck: founder pitch-deck export (a PAID deliverable).
 *
 * Under test (heavy generation + file bytes exercised for real via jszip; auth,
 * registry, and the document store are mocked so the route logic is deterministic):
 *   - PAID GATE: a company with no paid plan → 402 (never leaks a deck).
 *   - a PAID company → returns a real .pptx attachment composed from its artifacts.
 *   - GET (agent-accessible / AX) works the same as POST.
 *   - format=txt returns a plain-text deck.
 *   - the deck is composed from the company's persisted artifacts (document store),
 *     generating the missing core ones via the Claude stack (mocked).
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  documentScopeKey: vi.fn(() => 'owner::acme'),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  completeText: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/document-store', () => ({
  documentScopeKey: h.documentScopeKey,
  listDocuments: h.listDocuments,
  getDocument: h.getDocument,
}))
vi.mock('@/lib/build/claude-completion', () => ({ completeText: h.completeText }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET, POST } from '@/app/api/build/deck/route'

/** POST request stub. */
function postReq(body: unknown) {
  return { json: async () => body } as any
}
/** GET request stub with a query string. */
function getReq(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) } } as any
}

const MISSION =
  '## Executive Summary\nAcme automates SMB ops.\n## Key Findings\n- Owners waste hours on manual work.\n- No affordable autonomous tool exists.\n## Sources\n- https://example.com'

beforeEach(() => {
  Object.values(h).forEach((fn: any) => fn.mockReset?.())
  h.auth.mockResolvedValue({ user: { email: 'founder@acme.com', type: 'ainative' } })
  h.documentScopeKey.mockReturnValue('owner::acme')
  h.listDocuments.mockResolvedValue([])
  h.getDocument.mockResolvedValue(null)
  h.completeText.mockResolvedValue({ text: MISSION, provider: 'test', model: 'test' })
  delete process.env.DECK_DISABLE_PAYWALL
})

describe('POST /api/build/deck (#69) — paid gate', () => {
  it('400 when companyId is missing', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('402 when the company is NOT on a paid plan', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c', plan: undefined })
    const res = await POST(postReq({ companyId: 'acme', idea: 'x' }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('payment_required')
  })

  it('402 for a free/empty plan even with artifacts present', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c', plan: '' })
    const res = await POST(postReq({ companyId: 'acme' }))
    expect(res.status).toBe(402)
  })
})

describe('POST /api/build/deck (#69) — paid export', () => {
  beforeEach(() => {
    h.resolveApp.mockResolvedValue({
      slug: 'acme', chatId: 'c', plan: 'pro', name: 'Acme', tagline: 'Autonomy for SMBs', color: '#1E90FF',
    })
  })

  it('returns a real .pptx attachment for a paid company', async () => {
    const res = await POST(postReq({ companyId: 'acme', idea: 'AI ops copilot for SMBs' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('presentationml.presentation')
    expect(res.headers.get('Content-Disposition')).toContain('acme-pitch-deck.pptx')
    const buf = Buffer.from(await res.arrayBuffer())
    // .pptx is a ZIP → starts with the PK signature.
    expect(buf.length).toBeGreaterThan(500)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
    // Reports how many sections were backed by real artifacts.
    expect(Number(res.headers.get('X-Deck-Total-Sections'))).toBe(6)
    expect(Number(res.headers.get('X-Deck-Filled-Sections'))).toBeGreaterThan(0)
  })

  it('composes from persisted artifacts and generates the missing core ones', async () => {
    // A persisted mission doc exists; roadmap + market are missing → generated.
    h.listDocuments.mockResolvedValue([
      { id: 'd1', kind: 'document', type: 'mission', typeLabel: 'Mission', title: 'Mission', createdAt: '2026-08-24T00:00:00Z' },
    ])
    h.getDocument.mockResolvedValue({ id: 'd1', kind: 'document', type: 'mission', title: 'Mission', content: MISSION, createdAt: '2026-08-24T00:00:00Z' })

    const res = await POST(postReq({ companyId: 'acme', idea: 'AI ops copilot' }))
    expect(res.status).toBe(200)
    // Missing core artifacts (roadmap, market) were generated via the Claude stack.
    expect(h.completeText).toHaveBeenCalled()
    expect(h.getDocument).toHaveBeenCalledWith('owner::acme', 'd1')
  })

  it('returns a plain-text deck when format=txt', async () => {
    const res = await POST(postReq({ companyId: 'acme', idea: 'AI ops copilot', format: 'txt' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('Acme')
    expect(text).toContain('Problem')
    expect(text).toContain('The Ask')
  })

  it('honors DECK_DISABLE_PAYWALL for test/dev bypass', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c', plan: '' })
    process.env.DECK_DISABLE_PAYWALL = '1'
    const res = await POST(postReq({ companyId: 'acme' }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/build/deck (#69) — agent-accessible (AX)', () => {
  it('402 for a non-paid company via GET too', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c', plan: '' })
    const res = await GET(getReq('companyId=acme'))
    expect(res.status).toBe(402)
  })

  it('streams a .pptx for a paid company via GET', async () => {
    h.resolveApp.mockResolvedValue({ slug: 'acme', chatId: 'c', plan: 'business', name: 'Acme', color: '#1E90FF' })
    const res = await GET(getReq('companyId=acme&idea=AI%20ops%20copilot'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('presentationml.presentation')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })
})
