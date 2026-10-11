/**
 * #1056 — the Live dashboard's system cards must distinguish "provisioned"
 * (a real credential was issued) from "wired" (the generated app's own
 * source genuinely calls this primitive). Real evidence: `mendr` had 6
 * primitives provisioned, ALL unwired (zero /api/primitive/ calls anywhere in
 * its rendered source — only /api/db/waitlist and /api/db/visitors).
 * `flashpoint` / `habanero-hub` (also provisioned) genuinely called theirs
 * (socialgraph; zeropipeline + zerovoice, respectively) — so this is a
 * per-company signal, never inferred from provisioning alone.
 */
import { describe, it, expect } from 'vitest'
import { buildSystems } from '@/lib/build/business-systems'

const IDEA_INVOICE_COMMERCE_CAPSTACK =
  'storefront selling specialty coffee beans with invoicing and billing, plus cap table and SAFE fundraising for investors'

function byName(systems: ReturnType<typeof buildSystems>, name: string) {
  const s = systems.find((x) => x.primitive === name)
  expect(s, `expected system card for ${name}`).toBeDefined()
  return s!
}

describe('#1056 per-primitive wiring status', () => {
  it('reports wired:false for every provisioned primitive in the real mendr shape', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        zeroinvoiceProvisioned: true,
        commerceProvisioned: true,
        capstackProvisioned: true,
        // A real wiring scan ran and found NOTHING genuinely called.
        zeroinvoiceWired: false,
        commerceWired: false,
        capstackWired: false,
      },
      8,
    )

    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(true)
    expect(byName(systems, 'ZeroInvoice').wired).toBe(false)
    expect(byName(systems, 'ZeroCommerce').wired).toBe(false)
    expect(byName(systems, 'OpenCapStack').wired).toBe(false)
  })

  it('reports wired:true for a genuinely wired primitive (the real flashpoint/habanero-hub shape)', () => {
    const systems = buildSystems(
      'B2B sales CRM pipeline deals with voice calling',
      {},
      {
        provisioned: true,
        pipelineProvisioned: true,
        zerovoiceProvisioned: true,
        pipelineWired: true,
        zerovoiceWired: true,
      },
      8,
    )

    expect(byName(systems, 'ZeroPipeline').wired).toBe(true)
    expect(byName(systems, 'ZeroVoice').wired).toBe(true)
  })

  it('leaves `wired` undefined (not false) when no wiring scan has run yet — never a false downgrade', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        zeroinvoiceProvisioned: true,
        // No zeroinvoiceWired key at all — no scan has run for this company.
      },
      8,
    )

    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(true)
    expect(byName(systems, 'ZeroInvoice').wired).toBeUndefined()
  })

  it('distinguishes a REAL partial-wiring state: ZeroInvoice provisioned+wired, ZeroCommerce provisioned-not-wired', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        zeroinvoiceProvisioned: true,
        zeroinvoiceWired: true,
        commerceProvisioned: true,
        commerceWired: false,
      },
      8,
    )

    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(true)
    expect(byName(systems, 'ZeroInvoice').wired).toBe(true)
    expect(byName(systems, 'ZeroCommerce').provisioned).toBe(true)
    expect(byName(systems, 'ZeroCommerce').wired).toBe(false)
  })

  it('a primitive with no provisioning at all never reports wired:true, regardless of a stray flag', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        commerceProvisioned: false,
        commerceWired: true, // Should never happen in practice, but prove it's harmless.
      },
      8,
    )

    // provisioned stays the primary gate for buildSystems's own `provisioned`
    // field; a stray wired:true with no provisioning does not fabricate a
    // provisioned system — deriveSystemStatus's own 'planned' branch (no
    // provisioned signal) is what ultimately protects the badge, tested in
    // live-vs-planned.test.ts.
    expect(byName(systems, 'ZeroCommerce').provisioned).toBe(false)
  })
})
