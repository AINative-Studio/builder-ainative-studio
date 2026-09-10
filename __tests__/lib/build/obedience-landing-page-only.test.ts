import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { checkObedience } from '@/lib/build/obedience-gate'

/**
 * Real bug found live (Meridian, https://builder.ainative.studio/build/meridian,
 * 2026-09-10, issue #612): a Company-track landing page's underlying idea can
 * legitimately match a real primitive's trigger keywords (Meridian's idea
 * genuinely says "sales pipeline data" -> correctly matches ZeroPipeline) even
 * though company-app/route.ts's generation is marketing-copy-only (hero,
 * features, pricing, footer) — which has no legitimate reason to call ANY
 * primitive's live API. checkObedience used to flag this every time,
 * triggering a re-prompt ("call ZeroPipeline in your marketing page") that
 * pushed the model toward inventing pipeline-shaped UI in what should stay a
 * static page — confirmed live: 5 straight generation attempts truncated on
 * missing ./ui/* imports while this exact gap fired every single time.
 *
 * `landingPageOnly` opts a caller out of ONLY the primitive-compliance
 * check — every other gap (AIKit usage, persistence, visitor tracking, lead
 * capture, hardcoded toggles) still applies unconditionally, since those are
 * legitimately unconditional per this file's own existing design (see the
 * module doc comment's note about landing pages and the visitor-tracking
 * beacon being MANDATORY regardless).
 */
describe('checkObedience — landingPageOnly skips ONLY primitive-compliance (2026-09-10, #612)', () => {
  // An idea whose text genuinely matches ZeroPipeline's real triggers, and
  // code that never calls ZeroPipeline's real proxy path at all.
  const idea = 'A personalized business advisor that analyzes sales pipeline data and forecasts revenue.'
  const codeWithNoPrimitiveCall = `
    export default function App() {
      return <div>Marketing landing page — hero, features, pricing, footer.</div>
    }
  `

  it('without landingPageOnly, a landing-page-shaped idea still flags the primitive gap (existing behavior)', () => {
    const result = checkObedience(codeWithNoPrimitiveCall, idea)
    expect(result.primitiveComplianceGaps.length).toBeGreaterThan(0)
    expect(result.primitiveComplianceGaps).toContain('ZeroPipeline')
    expect(result.ok).toBe(false)
  })

  it('with landingPageOnly: true, the primitive-compliance gap is suppressed', () => {
    const result = checkObedience(codeWithNoPrimitiveCall, idea, undefined, { landingPageOnly: true })
    expect(result.primitiveComplianceGaps).toEqual([])
  })

  it('landingPageOnly does NOT suppress the visitor-tracking gap — that stays mandatory', () => {
    const result = checkObedience(codeWithNoPrimitiveCall, idea, undefined, { landingPageOnly: true })
    expect(result.visitorTrackingGap).toBe(true)
  })

  it('landingPageOnly does NOT suppress AIKit hand-rolling gaps', () => {
    const handRolledMetric = `
      export default function App() {
        return (
          <div className="stat-card"><span>Revenue</span><span>$84K</span><span>+12.5%</span></div>
        )
      }
    `
    const withFlag = checkObedience(handRolledMetric, 'a dashboard with metrics', undefined, { landingPageOnly: true })
    const withoutFlag = checkObedience(handRolledMetric, 'a dashboard with metrics')
    expect(withFlag.aikitGaps).toEqual(withoutFlag.aikitGaps)
  })
})

describe('chat-ws forwards landingPageOnly into every checkObedience call (2026-09-10, #612)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('destructures landingPageOnly from the request body', () => {
    // 2026-09-10: `internal` (the showcase skip-opt-out, unrelated to this
    // flag) was added after landingPageOnly in the same destructure, so the
    // trailing `}` no longer directly follows landingPageOnly.
    expect(source).toMatch(/landingPageOnly,\s*internal\s*\}\s*=\s*await request\.json\(\)/)
  })

  it('derives obedienceOptions from it, only truthy when explicitly true', () => {
    expect(source).toMatch(/obedienceOptions = landingPageOnly === true \? \{ landingPageOnly: true \} : undefined/)
  })

  it('every checkObedience call site passes obedienceOptions through', () => {
    const calls = [...source.matchAll(/checkObedience\(([^)]*)\)/g)]
    expect(calls.length).toBeGreaterThanOrEqual(4)
    for (const m of calls) {
      expect(m[1]).toMatch(/obedienceOptions/)
    }
  })
})

describe('company-app/route.ts sends landingPageOnly: true to chat-ws (2026-09-10, #612)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/build/company-app/route.ts'), 'utf8')

  it('the chat-ws request body includes landingPageOnly: true', () => {
    expect(source).toMatch(/JSON\.stringify\(\{ message, designSystemId, landingPageOnly: true \}\)/)
  })
})
