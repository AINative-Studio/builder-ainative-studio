/**
 * #832-class bug, continuing the sweep #1302/#1303/#1316/#1317/#1324/#1325
 * already did for /build/{slug}, preview-token minting, and the
 * waitlist/visitors routes: app/api/build/systems/route.ts and
 * app/api/build/growth/status/route.ts both resolved the company slug with
 * the plain resolveApp(), whose null return collapses "no such company"
 * with "the registry read itself failed". A transient ZeroDB hiccup made
 * both routes confidently report a false result to the Live dashboard
 * instead of surfacing "couldn't check" — systems/route.ts showed every
 * primitive as unprovisioned/unwired for a fully paid company, and
 * growth/status/route.ts 404'd "company_not_found" for a real, signed-in
 * founder's own company.
 *
 * Both now use resolveAppVerified() and fail closed with a 503 on an
 * unverified lookup; a confirmed-absent company still honestly reads
 * not-found/unprovisioned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  resolveAppVerified: vi.fn<(...args: any[]) => Promise<{ entry: any; verified: boolean }>>(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => '' }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/build/systems — honest failure on an unverified registry lookup', () => {
  it('503s with lookup_failed instead of fabricating an all-unprovisioned company', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { GET } = await import('@/app/api/build/systems/route')

    const res = await GET(new Request('https://builder.ainative.studio/api/build/systems?companyId=realco&idea=crm') as any)

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('lookup_failed')
  })

  it('still returns the honest zero-state 200 for a genuinely unprovisioned company (verified: true, no entry)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { GET } = await import('@/app/api/build/systems/route')

    const res = await GET(new Request('https://builder.ainative.studio/api/build/systems?companyId=brandnew&idea=crm') as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provisioned).toBe(false)
  })
})

describe('GET /api/build/growth/status — honest failure on an unverified registry lookup', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.GROWTH_AD_TESTING_ENABLED = 'true'
    process.env.METAADS_ACCESS_TOKEN = 'test-token'
    process.env.METAADS_AD_ACCOUNT_ID = 'act_test'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('503s with lookup_failed instead of a false company_not_found 404', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { GET } = await import('@/app/api/build/growth/status/route')

    const res = await GET(new NextRequest('https://builder.ainative.studio/api/build/growth/status?slug=realco'))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, reason: 'lookup_failed' })
  })

  it('still 404s honestly for a confirmed-absent company (verified: true, no entry)', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { GET } = await import('@/app/api/build/growth/status/route')

    const res = await GET(new NextRequest('https://builder.ainative.studio/api/build/growth/status?slug=ghostco'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, reason: 'company_not_found' })
  })
})
