import { describe, it, expect } from 'vitest'
import { CATALOG, RUNTIME_PROXY_PATH_SUBSTRINGS, getRuntimeProxyInstruction } from '@/lib/build/primitive-catalog'

/**
 * #788 (systemic follow-up to #774) — a structural CI invariant, not another
 * one-off patch. This exact bug class ("a primitive is SELECTED by trigger-
 * matching but Cody never gets told a real way to call it, or a compliance
 * check to catch an unwired selection") has been found and fixed piecemeal
 * at least 7 times before today (#518, #530, #624, #626, #632, #636, #640),
 * plus #774's own Stripe primitive nearly shipped with the identical gap —
 * caught only because this session happened to trace codegenCompositionBlock's
 * branch logic by hand while implementing something unrelated.
 *
 * There was previously NO test that would catch a NEW primitive being added
 * with this gap. These two tests are that structural check:
 *
 *  1. Every non-foundational primitive with real triggers must have EITHER
 *     `apiBase` or `sdk` — otherwise it's named to Cody (selectable,
 *     mentioned in the prompt) but silently excluded from
 *     codegenCompositionBlock's `wireable` list, which requires
 *     `p.apiBase || p.sdk`.
 *  2. Every primitive with a real `apiBase` must have a corresponding entry
 *     in RUNTIME_PROXY_PATH_SUBSTRINGS (the #518 compliance safety net) —
 *     otherwise an unwired selection of it in generated code goes
 *     completely undetected.
 *
 * EXEMPT_FROM_WIREABILITY / EXEMPT_FROM_COMPLIANCE_CHECK below are the
 * REAL, CURRENT gaps found live (2026-09-16) via this exact check — kept
 * as an explicit, visible, individually-justified allowlist (never a
 * blanket bypass) so:
 *   (a) this test can ship green today without lying about pre-existing debt,
 *   (b) each entry is a real, trackable TODO linked to #788, and
 *   (c) the test's REAL value — catching primitive #N+1 — starts working
 *       immediately: removing a name from an exempt list makes the test
 *       demand its real gap actually be closed, and adding an UNLISTED
 *       primitive to either list below with a genuine gap fails CI.
 */

// #788: real, live-confirmed gaps as of 2026-09-16 — named to Cody via real
// triggers, but neither apiBase nor sdk, so codegenCompositionBlock's
// `wireable` filter silently drops them. Fix = give each a real apiBase/sdk
// + a matching RUNTIME_PROXIED_PRIMITIVES instruction (see #774's Stripe
// entry for the pattern), then remove it from this list.
const EXEMPT_FROM_WIREABILITY = new Set([
  'Context Graph', // real triggers (knowledge graph/social/followers/etc.) — no apiBase/sdk. #788.
  'Data Marketplace', // real triggers (market data/enrichment/tam) — no apiBase/sdk. #788.
  'Multimodal', // real triggers (image/video/audio/avatar) — no apiBase/sdk. #788.
])

// #788: real, live-confirmed gaps as of 2026-09-16 — has a real apiBase
// (a genuinely callable service) but no RUNTIME_PROXY_PATH_SUBSTRINGS entry,
// so an unwired selection of any of these in generated code would go
// completely undetected — the exact pattern already fixed for ZeroCommerce/
// ZeroPipeline/ZeroInvoice/ServiceOS/etc. Fix = add a real, greppable
// call-shape substring (a proxy path or, for a non-proxied primitive like
// Stripe, a real SDK-call signature — see #774), then remove from this list.
const EXEMPT_FROM_COMPLIANCE_CHECK = new Set([
  'ZeroERP', // real apiBase, no RUNTIME_PROXY_PATH_SUBSTRINGS entry AND no runtime-proxy wiring at all yet. #788.
  'ZeroBooks', // same as ZeroERP — no compliance entry, no runtime-proxy wiring at all yet. #788.
  'QNN API', // real apiBase (quantum triggers) — no compliance entry. #788.
  'Ocean', // real apiBase — no compliance entry. #788.
  'SpaceTime OS', // real apiBase — no compliance entry. #788.
  'Intent-Casting Marketplace', // real apiBase — no compliance entry. #788.
  'Search & Discovery', // real apiBase — no compliance entry. #788.
])

describe('#788 — primitive catalog wireability invariant (structural, not per-primitive)', () => {
  it('every non-foundational primitive with real triggers has apiBase or sdk, unless explicitly exempted with a tracked reason', () => {
    const violations: string[] = []
    for (const p of CATALOG) {
      if (p.foundational) continue
      if (!p.triggers || p.triggers.length === 0) continue // empty triggers = never idea-selected, out of scope
      if (p.apiBase || p.sdk) continue
      if (EXEMPT_FROM_WIREABILITY.has(p.name)) continue
      violations.push(p.name)
    }
    expect(
      violations,
      `Primitive(s) with real triggers but neither apiBase nor sdk: ${violations.join(', ')}. ` +
        `A founder's idea can select these, but codegenCompositionBlock's \`wireable\` filter ` +
        `(requires apiBase || sdk) will silently exclude them from Cody's own codegen instructions — ` +
        `the exact gap #774's Stripe primitive almost shipped with. Either give this primitive a real ` +
        `apiBase/sdk, or add it to EXEMPT_FROM_WIREABILITY above with a reason (see #788).`,
    ).toEqual([])
  })

  it('every primitive with a real apiBase has a RUNTIME_PROXY_PATH_SUBSTRINGS compliance entry, unless explicitly exempted with a tracked reason', () => {
    const violations: string[] = []
    for (const p of CATALOG) {
      if (p.foundational) continue
      if (!p.apiBase) continue
      if (RUNTIME_PROXY_PATH_SUBSTRINGS[p.name]) continue
      if (EXEMPT_FROM_COMPLIANCE_CHECK.has(p.name)) continue
      violations.push(p.name)
    }
    expect(
      violations,
      `Primitive(s) with a real apiBase but no RUNTIME_PROXY_PATH_SUBSTRINGS entry: ${violations.join(', ')}. ` +
        `An unwired selection of any of these in generated code would go completely undetected by the ` +
        `#518 compliance validator — the exact pattern already fixed piecemeal for ZeroCommerce/ZeroPipeline/` +
        `ZeroInvoice/ServiceOS/etc. (#518/#530/#624/#626/#632/#636/#640). Add a real, greppable call-shape ` +
        `substring to RUNTIME_PROXY_PATH_SUBSTRINGS, or add it to EXEMPT_FROM_COMPLIANCE_CHECK above with a ` +
        `reason (see #788).`,
    ).toEqual([])
  })

  it('exemption lists never accumulate silently — every exempted name still genuinely exists in the catalog', () => {
    // Guards against the exemption lists themselves rotting: a renamed/
    // removed primitive should be caught here rather than the exemption
    // silently becoming dead weight that hides nothing real anymore.
    const catalogNames = new Set(CATALOG.map((p) => p.name))
    for (const name of EXEMPT_FROM_WIREABILITY) {
      expect(catalogNames.has(name), `EXEMPT_FROM_WIREABILITY names "${name}", which is no longer in CATALOG — remove it.`).toBe(true)
    }
    for (const name of EXEMPT_FROM_COMPLIANCE_CHECK) {
      expect(catalogNames.has(name), `EXEMPT_FROM_COMPLIANCE_CHECK names "${name}", which is no longer in CATALOG — remove it.`).toBe(true)
    }
  })

  it('a primitive fixed and removed from an exemption list must have BOTH a real apiBase/sdk AND a compliance entry (regression guard on the fix pattern itself)', () => {
    // Real bug this guards against: fixing gap #1 (wireability) for a
    // primitive without also fixing gap #2 (compliance) for it — e.g.
    // giving Multimodal an sdk without ever adding it to
    // RUNTIME_PROXY_PATH_SUBSTRINGS, silently reopening the SAME class of
    // gap this whole test exists to prevent. Only meaningful once a name is
    // actually removed from an exemption list — a no-op today.
    const wireableExempt = EXEMPT_FROM_WIREABILITY
    const complianceExempt = EXEMPT_FROM_COMPLIANCE_CHECK
    for (const p of CATALOG) {
      if (p.foundational) continue
      const isWireable = Boolean(p.apiBase || p.sdk) || wireableExempt.has(p.name)
      if (!isWireable) continue // caught by the first test already
      if (!p.apiBase) continue // sdk-only primitives (e.g. AI Kit) have no proxy path to check
      const hasComplianceEntry = Boolean(RUNTIME_PROXY_PATH_SUBSTRINGS[p.name]) || complianceExempt.has(p.name)
      expect(
        hasComplianceEntry,
        `${p.name} has a real apiBase and is not exempt from wireability, but has no compliance entry and ` +
          `is not in EXEMPT_FROM_COMPLIANCE_CHECK either — this is a real, currently-undetected gap.`,
      ).toBe(true)
    }
  })
})
