import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #63 — /api/build/{redeploy,secrets,export} routes.
 *
 * Shared invariants under test for all three:
 *   - a REAL (non-guest) session is required (401 otherwise),
 *   - the caller must OWN the company (403 otherwise),
 *   - a company with no dedicated Railway service can't redeploy/manage secrets (400),
 *   - secrets are MASKED on read + values are never returned in plaintext,
 *   - reserved secret names are rejected.
 * We mock auth + the app-registry + the railway/export libs so no network runs.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  redeployCurrent: vi.fn(),
  checkDeployHealth: vi.fn(),
  listServiceVariables: vi.fn(),
  upsertServiceVariable: vi.fn(),
  deleteServiceVariable: vi.fn(),
  buildCompanyExport: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, resolveApp: h.resolveApp }
})
vi.mock('@/lib/build/railway-deploy', async (orig) => {
  const actual = await (orig as any)()
  return {
    ...actual,
    redeployCurrent: h.redeployCurrent,
    checkDeployHealth: h.checkDeployHealth,
    listServiceVariables: h.listServiceVariables,
    upsertServiceVariable: h.upsertServiceVariable,
    deleteServiceVariable: h.deleteServiceVariable,
  }
})
vi.mock('@/lib/build/company-export', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, buildCompanyExport: h.buildCompanyExport }
})
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { POST as redeployPOST } from '@/app/api/build/redeploy/route'
import { GET as secretsGET, POST as secretsPOST, DELETE as secretsDELETE } from '@/app/api/build/secrets/route'
import { GET as exportGET, POST as exportPOST } from '@/app/api/build/export/route'

const OWNER = 'ada@x.com'
const REAL = { user: { email: OWNER, type: 'ainative' } }
const GUEST = { user: { email: 'guest-1@example.com', type: 'guest' } }
const OTHER = { user: { email: 'mallory@x.com', type: 'ainative' } }

const OWNED_APP = { slug: 'acme', ownerEmail: OWNER, railwayServiceId: 'svc-1', zerodbProjectId: 'proj-1', deployUrl: 'https://acme.up.railway.app' }

function bodyReq(body: unknown) {
  return { json: async () => body } as any
}
function urlReq(qs: string) {
  return { nextUrl: { searchParams: new URLSearchParams(qs) } } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as any).mockReset?.())
  h.resolveApp.mockResolvedValue(OWNED_APP)
})

// ---------------- redeploy ----------------
describe('POST /api/build/redeploy (#63.A)', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(401)
    expect(h.redeployCurrent).not.toHaveBeenCalled()
  })

  it('401 for a guest', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(401)
  })

  it('403 when the signed-in user does not own the company', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(403)
    expect(h.redeployCurrent).not.toHaveBeenCalled()
  })

  it('400 when the company has no dedicated service', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue({ ...OWNED_APP, railwayServiceId: undefined })
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(400)
    expect(h.redeployCurrent).not.toHaveBeenCalled()
  })

  it('redeploys + reports live when healthy', async () => {
    h.auth.mockResolvedValue(REAL)
    h.redeployCurrent.mockResolvedValue({ ok: true, deploymentId: 'dep-2' })
    h.checkDeployHealth.mockResolvedValue(true)
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, status: 'live', healthy: true, deploymentId: 'dep-2' })
  })

  it('reports redeploying (not live) when not yet healthy', async () => {
    h.auth.mockResolvedValue(REAL)
    h.redeployCurrent.mockResolvedValue({ ok: true, deploymentId: 'dep-2' })
    h.checkDeployHealth.mockResolvedValue(false)
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    const json = await res.json()
    expect(json.status).toBe('redeploying')
  })

  it('502 when the redeploy fails', async () => {
    h.auth.mockResolvedValue(REAL)
    h.redeployCurrent.mockResolvedValue({ ok: false, reason: 'boom' })
    const res = await redeployPOST(bodyReq({ companyId: 'acme' }))
    expect(res.status).toBe(502)
  })
})

// ---------------- secrets ----------------
describe('/api/build/secrets (#63.B)', () => {
  it('GET 401 for a guest', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await secretsGET(urlReq('companyId=acme'))
    expect(res.status).toBe(401)
  })

  it('GET 403 for a non-owner', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await secretsGET(urlReq('companyId=acme'))
    expect(res.status).toBe(403)
  })

  it('GET returns MASKED secrets (never plaintext)', async () => {
    h.auth.mockResolvedValue(REAL)
    h.listServiceVariables.mockResolvedValue({ ok: true, variables: { API_KEY: 'sk_live_superSecret', COMPANY_SLUG: 'acme' } })
    const res = await secretsGET(urlReq('companyId=acme'))
    const json = await res.json()
    expect(res.status).toBe(200)
    const names = json.secrets.map((s: any) => s.name)
    expect(names).toContain('API_KEY')
    // The raw value is never present anywhere in the response.
    expect(JSON.stringify(json)).not.toContain('superSecret')
    // COMPANY_SLUG is flagged reserved (read-only in the UI).
    expect(json.secrets.find((s: any) => s.name === 'COMPANY_SLUG').reserved).toBe(true)
  })

  it('GET degrades to an honest empty list when Railway is disabled', async () => {
    h.auth.mockResolvedValue(REAL)
    h.listServiceVariables.mockResolvedValue({ ok: false, reason: 'disabled' })
    const res = await secretsGET(urlReq('companyId=acme'))
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, secrets: [], available: false })
  })

  it('POST rejects a reserved name (400) without calling upsert', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await secretsPOST(bodyReq({ companyId: 'acme', name: 'COMPANY_SLUG', value: 'x' }))
    expect(res.status).toBe(400)
    expect(h.upsertServiceVariable).not.toHaveBeenCalled()
  })

  it('POST rejects an invalid name (400)', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await secretsPOST(bodyReq({ companyId: 'acme', name: 'bad name', value: 'x' }))
    expect(res.status).toBe(400)
  })

  it('POST upserts a valid secret', async () => {
    h.auth.mockResolvedValue(REAL)
    h.upsertServiceVariable.mockResolvedValue({ ok: true })
    const res = await secretsPOST(bodyReq({ companyId: 'acme', name: 'STRIPE_KEY', value: 'sk_live_x' }))
    expect(res.status).toBe(200)
    expect(h.upsertServiceVariable).toHaveBeenCalledWith('svc-1', 'STRIPE_KEY', 'sk_live_x')
  })

  it('DELETE removes a secret', async () => {
    h.auth.mockResolvedValue(REAL)
    h.deleteServiceVariable.mockResolvedValue({ ok: true })
    const res = await secretsDELETE(bodyReq({ companyId: 'acme', name: 'STRIPE_KEY' }))
    expect(res.status).toBe(200)
    expect(h.deleteServiceVariable).toHaveBeenCalledWith('svc-1', 'STRIPE_KEY')
  })

  it('DELETE refuses a reserved name', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await secretsDELETE(bodyReq({ companyId: 'acme', name: 'ZERODB_PROJECT_ID' }))
    expect(res.status).toBe(400)
    expect(h.deleteServiceVariable).not.toHaveBeenCalled()
  })
})

// ---------------- export ----------------
describe('GET /api/build/export (#63.C)', () => {
  it('401 for a guest', async () => {
    h.auth.mockResolvedValue(GUEST)
    const res = await exportGET(urlReq('companyId=acme&format=json'))
    expect(res.status).toBe(401)
  })

  it('403 for a non-owner', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await exportGET(urlReq('companyId=acme&format=json'))
    expect(res.status).toBe(403)
  })

  it('400 when the company has no data project', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue({ ...OWNED_APP, zerodbProjectId: undefined })
    const res = await exportGET(urlReq('companyId=acme&format=json'))
    expect(res.status).toBe(400)
  })

  it('downloads JSON as an attachment', async () => {
    h.auth.mockResolvedValue(REAL)
    h.buildCompanyExport.mockResolvedValue({
      ok: true,
      export: { projectId: 'proj-1', exportedAt: 'now', tableCount: 1, rowCount: 1, tables: [{ name: 't', rows: [{ id: 1 }] }] },
    })
    const res = await exportGET(urlReq('companyId=acme&format=json'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const text = await res.text()
    expect(JSON.parse(text).tables[0].name).toBe('t')
  })

  it('downloads CSV when format=csv', async () => {
    h.auth.mockResolvedValue(REAL)
    h.buildCompanyExport.mockResolvedValue({
      ok: true,
      export: { projectId: 'proj-1', exportedAt: 'now', tableCount: 1, rowCount: 1, tables: [{ name: 't', rows: [{ id: 1 }] }] },
    })
    const res = await exportGET(urlReq('companyId=acme&format=csv'))
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    const text = await res.text()
    expect(text).toContain('# table: t')
  })

  it('502 when the export build fails', async () => {
    h.auth.mockResolvedValue(REAL)
    h.buildCompanyExport.mockResolvedValue({ ok: false, reason: 'unavailable' })
    const res = await exportGET(urlReq('companyId=acme&format=json'))
    expect(res.status).toBe(502)
  })

  it('400 when companyId is missing', async () => {
    h.auth.mockResolvedValue(REAL)
    const res = await exportGET(urlReq('format=json'))
    expect(res.status).toBe(400)
  })

  it('POST (agent/programmatic) downloads too, defaulting an unknown format to json', async () => {
    h.auth.mockResolvedValue(REAL)
    h.buildCompanyExport.mockResolvedValue({
      ok: true,
      export: { projectId: 'proj-1', exportedAt: 'now', tableCount: 0, rowCount: 0, tables: [] },
    })
    const res = await exportPOST(bodyReq({ companyId: 'acme', format: 'xml' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('POST 403 for a non-owner', async () => {
    h.auth.mockResolvedValue(OTHER)
    const res = await exportPOST(bodyReq({ companyId: 'acme', format: 'json' }))
    expect(res.status).toBe(403)
  })
})
