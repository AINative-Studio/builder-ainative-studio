/**
 * GET /api/build/systems — the Live dashboard's per-primitive provisioning
 * status must come from each primitive's OWN registry flag (#1044).
 *
 * THE BUG: the route read `entry.zerodbProjectId` into one `provisioned`
 * boolean and handed it to buildSystems, which reused it for ZeroInvoice,
 * ZeroCommerce AND OpenCapStack alike. Confirmed live 2026-10-09 against the
 * real production company "silo": all three came back `provisioned: true`
 * identically, purely because the company had a ZeroDB project — not because
 * each primitive had actually been provisioned. Everything the route needed was
 * already on the `entry` it fetched (`zeroinvoiceProvisioned`,
 * `commerceProvisioned`, `capstackProvisioned`, … each written independently by
 * setAppProvisioned at provision time) and simply discarded.
 *
 * These tests drive the REAL route handler with a realistic partially-
 * provisioned registry entry and assert the response distinguishes primitives.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolveApp: vi.fn<(...args: any[]) => Promise<any>>(),
  getAinativeApiKey: vi.fn(() => ''),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: h.getAinativeApiKey }))

const IDEA =
  'storefront selling specialty coffee beans with invoicing and billing, plus cap table and SAFE fundraising for investors'

async function callRoute(companyId: string, idea = IDEA) {
  const { GET } = await import('@/app/api/build/systems/route')
  const url = `https://builder.ainative.studio/api/build/systems?companyId=${encodeURIComponent(
    companyId,
  )}&idea=${encodeURIComponent(idea)}`
  const res = await GET(new Request(url) as any)
  return res.json() as Promise<any>
}

function provisionedOf(body: any, name: string): boolean {
  const card = body.systems.find((s: any) => s.primitive === name)
  expect(card, `expected a system card for ${name}`).toBeDefined()
    return card.provisioned
}

beforeEach(() => {
  vi.clearAllMocks()
  // No service key → count reads short-circuit to {} without any network call.
  h.getAinativeApiKey.mockReturnValue('')
})

describe('#1044 GET /api/build/systems per-primitive provisioning', () => {
  it('distinguishes a real partial state: ZeroInvoice provisioned, ZeroCommerce + OpenCapStack not', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_silo',
      slug: 'silo',
      // The company DOES have a ZeroDB project — the old shared flag was true.
      zerodbProjectId: 'proj_real_silo',
      // ...but only ZeroInvoice actually got provisioned.
      zeroinvoiceProvisioned: true,
      commerceProvisioned: false,
      capstackProvisioned: false,
    })

    const body = await callRoute('silo')

    expect(provisionedOf(body, 'ZeroInvoice')).toBe(true)
    expect(provisionedOf(body, 'ZeroCommerce')).toBe(false)
    expect(provisionedOf(body, 'OpenCapStack')).toBe(false)
    // And the response surfaces the real per-primitive truth explicitly.
    expect(body.primitiveProvisioning).toMatchObject({
      zerodb: true,
      zeroinvoice: true,
      commerce: false,
      capstack: false,
    })
  })

  it('no longer returns provisioned:true for all three off a bare ZeroDB project (the live "silo" bug)', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_silo',
      slug: 'silo',
      zerodbProjectId: 'proj_real_silo',
      // No individual primitive flag was ever written for this company.
    })

    const body = await callRoute('silo')

    expect(provisionedOf(body, 'ZeroInvoice')).toBe(false)
    expect(provisionedOf(body, 'ZeroCommerce')).toBe(false)
    expect(provisionedOf(body, 'OpenCapStack')).toBe(false)
  })

  it('shows all Live when every primitive is genuinely provisioned', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_full',
      slug: 'fullyprovisioned',
      zerodbProjectId: 'proj_full',
      pipelineProvisioned: true,
      zeroinvoiceProvisioned: true,
      commerceProvisioned: true,
      capstackProvisioned: true,
      serviceosProvisioned: true,
    })

    const body = await callRoute('fullyprovisioned')

    expect(provisionedOf(body, 'ZeroInvoice')).toBe(true)
    expect(provisionedOf(body, 'ZeroCommerce')).toBe(true)
    expect(provisionedOf(body, 'OpenCapStack')).toBe(true)
    expect(body.primitiveProvisioning.pipeline).toBe(true)
    expect(body.primitiveProvisioning.serviceos).toBe(true)
  })

  it('shows all Planned for a freshly-created, unprovisioned company', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'chat_new', slug: 'brandnew' })

    const body = await callRoute('brandnew')

    expect(body.provisioned).toBe(false)
    for (const s of body.systems) {
      expect(s.provisioned, `${s.primitive} should be Planned`).toBe(false)
    }
    for (const [k, v] of Object.entries(body.primitiveProvisioning as Record<string, boolean>)) {
      expect(v, `primitiveProvisioning.${k} should be false`).toBe(false)
    }
  })

  it('keeps ZeroPipeline on its own flag (unregressed) and does not infer it from ZeroDB', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_crm',
      slug: 'crmco',
      zerodbProjectId: 'proj_crm',
      pipelineProvisioned: false,
    })

    const body = await callRoute('crmco', 'B2B sales CRM pipeline deals')

    expect(provisionedOf(body, 'ZeroPipeline')).toBe(false)
    expect(body.pipelineProvisioned).toBe(false)
    expect(body.provisioned).toBe(true)
  })

  it('still reports the shared `provisioned` field (ZeroDB project presence) for existing consumers', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_x',
      slug: 'x',
      zerodbProjectId: 'proj_x',
      pipelineProvisioned: true,
    })

    const body = await callRoute('x')

    // Live.tsx reads `provisioned` for the cloud-provisioning banner/button —
    // it must keep meaning "this company has its own ZeroDB project".
    expect(body.provisioned).toBe(true)
    expect(body.pipelineProvisioned).toBe(true)
  })
})
