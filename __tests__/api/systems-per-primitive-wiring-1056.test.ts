/**
 * GET /api/build/systems — #1056: the route must surface each primitive's
 * real WIRING state (distinct from provisioning), read straight off the
 * registry entry's `*Wired` fields (set by runWiringScan at register-app
 * time). Mirrors the #1044 provisioning test's shape exactly, one level
 * deeper — "has a key" vs "the app's code genuinely calls it".
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

function wiredOf(body: any, name: string): boolean | undefined {
  const card = body.systems.find((s: any) => s.primitive === name)
  expect(card, `expected a system card for ${name}`).toBeDefined()
  return card.wired
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getAinativeApiKey.mockReturnValue('')
})

describe('#1056 GET /api/build/systems per-primitive wiring', () => {
  it('reports wired:false for every primitive in the real mendr shape (provisioned, scan ran, nothing wired)', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_mendr',
      slug: 'mendr',
      zeroinvoiceProvisioned: true,
      commerceProvisioned: true,
      capstackProvisioned: true,
      zeroinvoiceWired: false,
      commerceWired: false,
      capstackWired: false,
      wiringScannedAt: '2026-10-09T00:00:00.000Z',
    })

    const body = await callRoute('mendr')

    expect(wiredOf(body, 'ZeroInvoice')).toBe(false)
    expect(wiredOf(body, 'ZeroCommerce')).toBe(false)
    expect(wiredOf(body, 'OpenCapStack')).toBe(false)
    expect(body.primitiveWiring).toMatchObject({
      zeroinvoice: false,
      commerce: false,
      capstack: false,
    })
  })

  it('reports wired:true for a genuinely wired primitive (the real flashpoint/habanero-hub shape)', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_hh',
      slug: 'habanero-hub',
      pipelineProvisioned: true,
      zerovoiceProvisioned: true,
      pipelineWired: true,
      zerovoiceWired: true,
    })

    const body = await callRoute('habanero-hub', 'B2B sales CRM pipeline deals with voice calling')

    expect(wiredOf(body, 'ZeroPipeline')).toBe(true)
    expect(wiredOf(body, 'ZeroVoice')).toBe(true)
    expect(body.primitiveWiring.pipeline).toBe(true)
    expect(body.primitiveWiring.zerovoice).toBe(true)
  })

  it('leaves wired undefined (never a fabricated false) when no scan has run yet for a freshly-registered company', async () => {
    h.resolveApp.mockResolvedValue({ chatId: 'chat_new', slug: 'brandnew' })

    const body = await callRoute('brandnew')

    for (const s of body.systems) {
      expect(s.wired, `${s.primitive} should have no wiring verdict yet`).toBeUndefined()
    }
    for (const [k, v] of Object.entries(body.primitiveWiring as Record<string, boolean | undefined>)) {
      expect(v, `primitiveWiring.${k} should be undefined`).toBeUndefined()
    }
  })

  it('#1044 provisioning stays unregressed when wiring flags are also present', async () => {
    h.resolveApp.mockResolvedValue({
      chatId: 'chat_x',
      slug: 'x',
      zerodbProjectId: 'proj_x',
      pipelineProvisioned: true,
      pipelineWired: false,
    })

    const body = await callRoute('x', 'B2B sales CRM pipeline deals')

    expect(body.provisioned).toBe(true)
    expect(body.pipelineProvisioned).toBe(true)
    expect(wiredOf(body, 'ZeroPipeline')).toBe(false)
  })
})
