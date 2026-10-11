/**
 * Primitive wiring detection (#1056) — a real UI/wiring-verified signal
 * distinct from `*Provisioned` (credential issuance).
 *
 * Real audit evidence (#1056): the `mendr` company (track: 'company') had 6
 * primitives marked provisioned (real credentials issued), but its rendered
 * app source had ZERO fetch calls to any primitive-proxy endpoint — only
 * /api/db/waitlist and /api/db/visitors. The registry had no way to tell
 * "has a key" apart from "the app code genuinely calls it."
 *
 * Follow-up spot-check (#1056 suggestion #3) on real track:'app' companies
 * found the gap is NOT universal: 'flashpoint' and 'habanero-hub' (both
 * track: 'app') genuinely call their provisioned primitives
 * (`/api/primitive/socialgraph/...`, `/api/primitive/zeropipeline/...`,
 * `/api/primitive/zerovoice/...`), while 'castlo', 'credfix-verify-*' and
 * 'aerosol' (also track: 'app', also provisioned) have zero real calls —
 * same gap as mendr. So this is a PER-COMPANY defect, not a track-specific
 * one; detection must run per generation, not be inferred from track alone.
 *
 * This module extracts which primitives a generated app's source genuinely
 * calls via the real runtime path (`/api/primitive/{name}/...`, the same
 * prefix the preview iframe's fetch shim and the production primitive-proxy
 * route key off). Pure + deterministic, mirroring extractDbTables in
 * seed-check.ts.
 */
import { describe, it, expect } from 'vitest'
import { extractWiredPrimitives, computeWiringFlags, WIRING_FLAG_BY_PRIMITIVE } from '@/lib/build/primitive-wiring'

describe('#1056 extractWiredPrimitives', () => {
  it('finds zero wired primitives in the real mendr-shaped source (static JSX, no primitive fetch calls)', () => {
    const code = `
      function App() {
        const submit = () => fetch('/api/db/waitlist', { method: 'POST', body: JSON.stringify(form) })
        return (
          <div>
            <h1>Now onboarding repair shops</h1>
            {/* Active Tickets panel — static hardcoded JSX, not real data */}
            <div className="ticket">SR-1042</div>
            <div className="ticket">SR-1043</div>
            <div className="ticket">SR-1044</div>
          </div>
        )
      }
      fetch('/api/db/visitors', { method: 'POST' })
    `
    expect(extractWiredPrimitives(code)).toEqual([])
  })

  it('finds a plain string-literal primitive-proxy call', () => {
    const code = `fetch('/api/primitive/zeropipeline/api/v1/deals')`
    expect(extractWiredPrimitives(code)).toEqual(['zeropipeline'])
  })

  it('finds template-literal primitive-proxy calls (real habanero-hub shape)', () => {
    const code = `
      fetch(\`/api/primitive/zeropipeline/api/v1/deals?owner=\${userId}\`)
      fetch(\`/api/primitive/zerovoice/api/v1/calls\`, { method: 'GET' })
      fetch(\`/api/primitive/contentworkflow/api/v1/posts\`)
    `
    const wired = extractWiredPrimitives(code)
    expect(wired).toContain('zeropipeline')
    expect(wired).toContain('zerovoice')
    expect(wired).toContain('contentworkflow')
    expect(wired).toHaveLength(3)
  })

  it('finds a real socialgraph call shaped like the flashpoint source', () => {
    const code = `
      const res = await fetch(\`/api/primitive/socialgraph/api/v1/social/\${currentUserId}/followers\`)
      await fetch(\`/api/primitive/socialgraph/api/v1/social/follow/\${targetUserId}\`, { method: 'POST' })
    `
    expect(extractWiredPrimitives(code)).toEqual(['socialgraph'])
  })

  it('does not count the preview iframe fetch-shim boilerplate as a wired call', () => {
    // The shim's own prefix-check string, not a generated-app call (verified
    // live in castlo/credfix/aerosol's rendered source — this exact string is
    // present, but is the injected shim, not app code).
    const code = `} else if(u.indexOf('/api/primitive/')===0){`
    expect(extractWiredPrimitives(code)).toEqual([])
  })

  it('deduplicates repeated calls to the same primitive', () => {
    const code = `
      fetch('/api/primitive/serviceos/api/v1/tickets')
      fetch('/api/primitive/serviceos/api/v1/tickets/1')
      fetch('/api/primitive/serviceos/api/v1/tickets/2')
    `
    expect(extractWiredPrimitives(code)).toEqual(['serviceos'])
  })

  it('ignores unknown/non-primitive path segments', () => {
    const code = `fetch('/api/primitive/')`
    expect(extractWiredPrimitives(code)).toEqual([])
  })

  it('returns empty for empty/undefined code (fail-open shape)', () => {
    expect(extractWiredPrimitives('')).toEqual([])
    expect(extractWiredPrimitives(undefined as unknown as string)).toEqual([])
  })
})

describe('#1056 computeWiringFlags', () => {
  it('sets *Wired true only for primitives the code genuinely calls', () => {
    const code = `fetch(\`/api/primitive/zeroinvoice/api/v1/invoices\`)`
    const flags = computeWiringFlags(code)
    expect(flags.zeroinvoiceWired).toBe(true)
    expect(flags.zerocrmWired).toBe(false)
    expect(flags.capstackWired).toBe(false)
    expect(flags.serviceosWired).toBe(false)
    expect(flags.socialgraphWired).toBe(false)
    expect(flags.livestreamingWired).toBe(false)
    expect(flags.pipelineWired).toBe(false)
  })

  it('sets every mapped flag false for a mendr-shaped app (provisioned but nothing wired)', () => {
    const code = `
      fetch('/api/db/waitlist', { method: 'POST' })
      fetch('/api/db/visitors', { method: 'POST' })
    `
    const flags = computeWiringFlags(code)
    for (const key of Object.values(WIRING_FLAG_BY_PRIMITIVE)) {
      expect(flags[key], `${key} should be false`).toBe(false)
    }
  })

  it('sets multiple flags true for a multi-primitive app (habanero-hub shape)', () => {
    const code = `
      fetch(\`/api/primitive/zeropipeline/api/v1/deals\`)
      fetch(\`/api/primitive/zerovoice/api/v1/calls\`)
    `
    const flags = computeWiringFlags(code)
    expect(flags.pipelineWired).toBe(true)
    expect(flags.zerovoiceWired).toBe(true)
    expect(flags.zeroinvoiceWired).toBe(false)
  })
})
