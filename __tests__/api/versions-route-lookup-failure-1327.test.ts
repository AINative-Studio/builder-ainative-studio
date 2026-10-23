import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #832-class bug (#1327), continuing the sweep #1302/#1303/#1316/#1317/
 * #1324/#1325/#1328/#1329 already did: app/api/build/versions/route.ts
 * resolved the company with the plain resolveApp(), whose null return
 * collapses "no dedicated Railway service" with "the registry read itself
 * failed".
 *
 * GET stays at the existing honest single-version fallback either way (the
 * endpoint already has that empty state for a genuinely unprovisioned
 * company — a registry hiccup never produces a FALSE claim here, just a
 * temporarily incomplete one, same lower-severity judgment #1327 itself
 * made), but now also surfaces `verified` so a caller could eventually tell
 * "not provisioned" apart from "couldn't check".
 *
 * POST is the real bug: a transient registry hiccup used to 400 "no
 * dedicated service to roll back" for a company that actually has one —
 * falsely rejecting a real, deliberate, already-UI-confirmed rollback
 * action. Now fails closed with a retryable 503 instead.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveAppVerified: vi.fn<(...args: any[]) => Promise<{ entry: any; verified: boolean }>>(),
  listDeployments: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: h.resolveAppVerified }))
vi.mock('@/lib/build/railway-deploy', () => ({
  listDeployments: h.listDeployments,
  redeployDeployment: vi.fn(),
  checkDeployHealth: vi.fn(),
  isRollbackTarget: vi.fn(() => true),
}))
vi.mock('@/lib/build/version-store', () => ({
  loadVersionIndex: vi.fn(async () => new Map()),
  joinVersions: vi.fn(() => []),
  singleVersionFallback: vi.fn(() => [{ id: 'v1', label: 'v1 · initial deploy', current: true }]),
}))

function getReq(url: string) {
  return { nextUrl: new URL(url) } as any
}
function postReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
})

describe('GET /api/build/versions — honest fallback on an unverified registry lookup', () => {
  it('still serves the honest single-version fallback on an UNVERIFIED lookup, surfacing verified:false', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { GET } = await import('@/app/api/build/versions/route')

    const res: any = await GET(getReq('http://localhost/api/build/versions?companyId=realco'))
    const json = await res.json()

    expect(json.serviced).toBe(false)
    expect(json.verified).toBe(false)
    expect(json.versions.length).toBeGreaterThan(0)
  })

  it('serves the same honest fallback for a CONFIRMED unprovisioned company, with verified:true', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
    const { GET } = await import('@/app/api/build/versions/route')

    const res: any = await GET(getReq('http://localhost/api/build/versions?companyId=brandnew'))
    const json = await res.json()

    expect(json.serviced).toBe(false)
    expect(json.verified).toBe(true)
  })
})

describe('POST /api/build/versions — fails closed on an unverified registry lookup', () => {
  it('503s with lookup_failed instead of falsely rejecting a real rollback as "no dedicated service"', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
    const { POST } = await import('@/app/api/build/versions/route')

    const res: any = await POST(postReq({ companyId: 'realco', deploymentId: 'dep-1' }))

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('lookup_failed')
    expect(h.listDeployments).not.toHaveBeenCalled()
  })

  it('still 400s honestly for a CONFIRMED company with no dedicated service', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'realco' }, verified: true })
    const { POST } = await import('@/app/api/build/versions/route')

    const res: any = await POST(postReq({ companyId: 'realco', deploymentId: 'dep-1' }))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('no dedicated service to roll back')
  })

  it('proceeds to look up deployments for a CONFIRMED company with a real service', async () => {
    h.resolveAppVerified.mockResolvedValue({ entry: { slug: 'realco', railwayServiceId: 'svc-1' }, verified: true })
    h.listDeployments.mockResolvedValue({ ok: true, deployments: [] })
    const { POST } = await import('@/app/api/build/versions/route')

    const res: any = await POST(postReq({ companyId: 'realco', deploymentId: 'dep-1' }))

    expect(h.listDeployments).toHaveBeenCalledWith('svc-1')
    expect(res.status).toBe(404) // deployment not found in the (empty) history — a real, different failure mode
  })
})
