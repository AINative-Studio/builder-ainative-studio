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
    const block = source.slice(idx, idx + 1600)
    expect(block).toMatch(/onClick=\{\(\) => provisionCompany\(\)\}/)
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
    expect(nearby).toMatch(/disabled=\{provision\.busy/)
  })
})

/**
 * Issue #1591 — real incident: live-testing #1585/#1586's auto-provision fix
 * on `dwello` hit core's real, non-transient "max 5 instant databases per IP
 * per day" rate limit. Before this fix, a rate-limited provision attempt
 * (reason:'provision_failed', status:429) was indistinguishable from any
 * other failure from the UI's perspective — the founder silently fell
 * through to the generic "Nothing's been provisioned yet. Click below..."
 * copy, which falsely implies retrying now will help and that this
 * "normally happens automatically", when in fact every retry today will
 * fail identically until the daily window resets.
 */
describe('Live screen — honest rate-limit state for provisioning (#1591)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('provisionCompany() can resolve to a rate_limited result distinct from not_registered/error', () => {
    expect(source).toMatch(/'ok' \| 'not_registered' \| 'rate_limited' \| 'error'/)
  })

  it('detects the rate limit from the real /api/build/provision response shape (reason + status), not generic failure', () => {
    expect(source).toMatch(/d\?\.reason === 'provision_failed' && d\?\.status === 429/)
  })

  it('a rate-limited result never reschedules the auto-provision retry loop', () => {
    const idx = source.indexOf('const attempt = async () => {')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 500)
    expect(block).toMatch(/result === 'not_registered'/)
    expect(block).not.toMatch(/result === 'rate_limited'/)
  })

  it('the provisioning banner shows distinct, honest copy when rate-limited — checked before the generic fallback copy', () => {
    const idx = source.indexOf('data-testid="provisioning-banner"')
    const block = source.slice(idx, idx + 1200)
    const rateLimitedIdx = block.indexOf('provisionRateLimited')
    const fallbackIdx = block.indexOf("Nothing's been provisioned yet")
    expect(rateLimitedIdx).toBeGreaterThan(-1)
    expect(fallbackIdx).toBeGreaterThan(-1)
    expect(rateLimitedIdx).toBeLessThan(fallbackIdx)
    expect(block).toMatch(/resets daily|try again later/i)
    expect(block).not.toMatch(/provisionRateLimited[\s\S]{0,80}normally happens automatically/)
  })

  it('the primary CTA disables and relabels while rate-limited, instead of offering a doomed retry', () => {
    const idx = source.indexOf('data-testid="provision-now-cta"')
    const block = source.slice(idx, idx + 300)
    expect(block).toMatch(/disabled=\{provision\.busy \|\| provisionRateLimited\}/)
    expect(block).toMatch(/provisionRateLimited \? 'Limit reached'/)
  })

  it('the secondary infrastructure-card CTA also disables while rate-limited', () => {
    const idx = source.indexOf("{/* Provision the real per-company cloud (#243)")
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 600)
    expect(block).toMatch(/disabled=\{provision\.busy \|\| provision\.provisioned \|\| provisionRateLimited\}/)
  })
})
