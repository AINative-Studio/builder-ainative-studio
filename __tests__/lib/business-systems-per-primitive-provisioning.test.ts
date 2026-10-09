/**
 * #1044 — the Live dashboard's "Business systems" Live/Planned badge must reflect
 * EACH primitive's own real provisioning state, not one shared
 * "does this company have any ZeroDB project at all" boolean.
 *
 * Before this fix, buildSystems collapsed ZeroInvoice / ZeroCommerce / OpenCapStack
 * onto `opts.provisioned` (derived from `entry.zerodbProjectId`), so all three showed
 * an identical badge regardless of whether each one was actually provisioned. The
 * per-primitive truth already exists on the registry entry (`zeroinvoiceProvisioned`,
 * `commerceProvisioned`, `capstackProvisioned`, … written independently at provision
 * time) — these tests pin that each primitive reads its OWN flag.
 */
import { describe, it, expect } from 'vitest'
import { buildSystems } from '@/lib/build/business-systems'

/**
 * An idea that deterministically surfaces ZeroInvoice, ZeroCommerce and
 * OpenCapStack together so one call can assert all three diverge.
 */
const IDEA_INVOICE_COMMERCE_CAPSTACK =
  'storefront selling specialty coffee beans with invoicing and billing, plus cap table and SAFE fundraising for investors'

function byName(systems: ReturnType<typeof buildSystems>, name: string) {
  const s = systems.find((x) => x.primitive === name)
  expect(s, `expected system card for ${name}`).toBeDefined()
  return s!
}

describe('#1044 per-primitive provisioning status (no shared collapse)', () => {
  it('distinguishes a realistic PARTIAL provisioning state (ZeroInvoice live, ZeroCommerce + OpenCapStack not)', () => {
    // Real shape: the company HAS a ZeroDB project (so the old shared `provisioned`
    // boolean is true), but only ZeroInvoice actually got provisioned.
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        zeroinvoiceProvisioned: true,
        commerceProvisioned: false,
        capstackProvisioned: false,
      },
      8,
    )

    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(true)
    expect(byName(systems, 'ZeroCommerce').provisioned).toBe(false)
    expect(byName(systems, 'OpenCapStack').provisioned).toBe(false)
  })

  it('distinguishes the inverse partial state (ZeroCommerce live, ZeroInvoice + OpenCapStack not)', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        zeroinvoiceProvisioned: false,
        commerceProvisioned: true,
        capstackProvisioned: false,
      },
      8,
    )

    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(false)
    expect(byName(systems, 'ZeroCommerce').provisioned).toBe(true)
    expect(byName(systems, 'OpenCapStack').provisioned).toBe(false)
  })

  it('does not collapse three different primitives onto one identical value', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      { provisioned: true, capstackProvisioned: true },
      8,
    )
    const trio = ['ZeroInvoice', 'ZeroCommerce', 'OpenCapStack'].map(
      (n) => byName(systems, n).provisioned,
    )
    // Exactly one of the three is really provisioned — they must not all match.
    expect(new Set(trio).size).toBeGreaterThan(1)
    expect(trio).toEqual([false, false, true])
  })

  it('shows every relevant primitive Live when ALL are genuinely provisioned', () => {
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      {
        provisioned: true,
        pipelineProvisioned: true,
        zeroinvoiceProvisioned: true,
        commerceProvisioned: true,
        capstackProvisioned: true,
        serviceosProvisioned: true,
        socialgraphProvisioned: true,
        livestreamingProvisioned: true,
        zerovoiceProvisioned: true,
      },
      12,
    )
    const flagged = new Set([
      'ZeroPipeline', 'ZeroInvoice', 'ZeroCommerce', 'OpenCapStack',
      'ServiceOS', 'Social Graph', 'Live Streaming', 'ZeroVoice',
    ])
    for (const s of systems) {
      if (flagged.has(s.primitive)) {
        expect(s.provisioned, `${s.primitive} should be Live`).toBe(true)
      }
    }
  })

  it('shows everything Planned for a freshly-created company with nothing provisioned', () => {
    const systems = buildSystems(IDEA_INVOICE_COMMERCE_CAPSTACK, {}, {}, 12)
    for (const s of systems) {
      expect(s.provisioned, `${s.primitive} should be Planned`).toBe(false)
    }
  })

  it('a ZeroDB project alone no longer implies ZeroInvoice/ZeroCommerce/OpenCapStack are Live', () => {
    // The exact live-production state from #1044: entry.zerodbProjectId exists, so
    // the shared flag is true, but no individual primitive flag was ever written.
    const systems = buildSystems(
      IDEA_INVOICE_COMMERCE_CAPSTACK,
      {},
      { provisioned: true },
      8,
    )
    expect(byName(systems, 'ZeroInvoice').provisioned).toBe(false)
    expect(byName(systems, 'ZeroCommerce').provisioned).toBe(false)
    expect(byName(systems, 'OpenCapStack').provisioned).toBe(false)
  })

  describe('primitives that were NOT part of the bug stay correct', () => {
    it('ZeroPipeline still reads its own pipelineProvisioned flag', () => {
      const live = buildSystems('B2B sales CRM pipeline deals', {}, { pipelineProvisioned: true })
      expect(byName(live, 'ZeroPipeline').provisioned).toBe(true)

      const planned = buildSystems('B2B sales CRM pipeline deals', {}, { pipelineProvisioned: false })
      expect(byName(planned, 'ZeroPipeline').provisioned).toBe(false)
    })

    it('ZeroPipeline is NOT Live merely because a ZeroDB project exists', () => {
      const s = buildSystems('B2B sales CRM pipeline deals', {}, { provisioned: true })
      expect(byName(s, 'ZeroPipeline').provisioned).toBe(false)
    })

    it('primitives with no registry provisioning flag stay honestly Planned', () => {
      // Community / Context Graph / Search & Discovery / Content Workflow have no
      // per-company provisioning signal in the registry at all — never claim Live.
      const systems = buildSystems(
        'a social community app with groups, feeds, semantic search and a knowledge graph',
        {},
        { provisioned: true, pipelineProvisioned: true },
        12,
      )
      const noFlag = new Set(['Community', 'Context Graph', 'Search & Discovery', 'Content Workflow'])
      for (const s of systems) {
        if (noFlag.has(s.primitive)) {
          expect(s.provisioned, `${s.primitive} has no real flag; must be Planned`).toBe(false)
        }
      }
    })

    it('ZeroDB reads the real zerodbProjectId-backed flag (it IS the ZeroDB project)', () => {
      const s = buildSystems('a note-taking app that stores posts and records', {}, { provisioned: true }, 12)
      const zdb = s.find((x) => x.primitive === 'ZeroDB')
      if (zdb) expect(zdb.provisioned).toBe(true)
    })
  })
})
