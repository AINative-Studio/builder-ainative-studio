import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Issue #748 — real incident: an admin-created company ("Clearpath") had a
 * live, reachable dashboard but was NEVER actually provisioned (no owner, no
 * ZeroDB project, no primitives, no auth) because the upgrade/trial banner on
 * Live.tsx only ever had THREE states — paid, signed-in-with-trial, and
 * anonymous — and the signed-in-with-trial branch's copy/CTA assumed a trial
 * (and therefore provisioning) already existed. A signed-in founder whose
 * company was never provisioned fell into that branch anyway, with dishonest
 * copy and a CTA (`goUpgrade`) that does nothing to actually provision them.
 *
 * These are source-level assertions (matching this repo's existing pattern
 * for Live.tsx, e.g. enterprise-billing-routing.test.ts) since Live.tsx pulls
 * in heavy context/hook dependencies that make full rendering impractical
 * here — the real, deployed behavior is verified separately via Playwright.
 */
describe('Live screen — 4th CTA state for signed-in-but-not-yet-provisioned (#748)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('has a distinct provisioning banner branch, checked BEFORE the trial banner branch', () => {
    const provisioningIdx = source.indexOf('data-testid="provisioning-banner"')
    const trialIdx = source.indexOf('data-testid="upgrade-banner"')
    expect(provisioningIdx).toBeGreaterThan(-1)
    expect(trialIdx).toBeGreaterThan(-1)
    expect(provisioningIdx).toBeLessThan(trialIdx)
  })

  it('the provisioning banner is gated on signedIn && !provision.provisioned, not just !activePlan', () => {
    expect(source).toMatch(/signedIn && !provision\.provisioned \?/)
  })

  it('the provisioning banner never claims a trial already exists', () => {
    const idx = source.indexOf('data-testid="provisioning-banner"')
    const block = source.slice(idx, idx + 900)
    expect(block).not.toMatch(/trialHoursLeft/)
    expect(block).not.toMatch(/Free trial/)
  })

  it('the provisioning banner CTA actually triggers provisionCompany, not goUpgrade', () => {
    const idx = source.indexOf('data-testid="provisioning-banner"')
    const block = source.slice(idx, idx + 900)
    expect(block).toMatch(/onClick=\{provisionCompany\}/)
    expect(block).not.toMatch(/onClick=\{goUpgrade\}/)
  })

  it('the provisioning banner has honest, distinct copy for the busy/auto-provisioning state vs the fallback manual-trigger state', () => {
    const idx = source.indexOf('data-testid="provisioning-banner"')
    const block = source.slice(idx, idx + 900)
    expect(block).toMatch(/provision\.busy \|\| !provision\.checked/)
    expect(block).toMatch(/automatically/i)
  })

  it('the CTA button disables while a provision call is in flight', () => {
    const idx = source.indexOf('data-testid="provision-now-cta"')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 200)
    expect(nearby).toMatch(/disabled=\{provision\.busy\}/)
  })
})
