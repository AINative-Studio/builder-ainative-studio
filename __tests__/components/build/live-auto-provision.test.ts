import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Issue #748 — auto-provision on first real engagement, task 1. Real
 * incident: an admin-created company ("Clearpath") never got provisioned
 * because the ONLY way to trigger /api/build/provision was a "Provision
 * cloud" button buried in the "Website & infrastructure" card — nothing in
 * the founder's actual journey (landing -> idea -> chat -> dashboard) told
 * them it existed or was required. Live.tsx must now call the same
 * provisionCompany() logic automatically once a signed-in founder's company
 * is confirmed (via the real GET /api/build/provision status check) to be
 * unprovisioned — no hidden manual step required.
 *
 * RETRY-WITH-BACKOFF (found via real Playwright verification against
 * production, not assumed from reading the code): a brand-new company's
 * registry row is written by the DETACHED background /api/build/company-app
 * generation this same screen kicks off, which the code's own comment says
 * can take up to ~5 minutes (its own poll budget). A live test against
 * https://builder.ainative.studio confirmed /api/build/provision genuinely
 * 404s with reason 'not_registered' when auto-provision fires before that
 * generation completes — a real, observed race, not a hypothetical. The
 * first implementation (a single fire-once attempt) left the founder stuck
 * exactly as before if it lost that race: the manual CTA also 404'd with no
 * useful retry. The fix: treat 'not_registered' as TRANSIENT and retry with
 * linear backoff, capped, so a genuinely fresh company still gets
 * auto-provisioned once its registration lands, without hammering the API.
 *
 * Source-level assertions (this repo's existing pattern for Live.tsx — see
 * enterprise-billing-routing.test.ts) since Live.tsx has heavy
 * context/session/hook dependencies that make full component rendering
 * impractical here.
 */
describe('Live screen — auto-provision on first engagement (#748)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('has a dedicated auto-provision effect distinct from the manual "Provision cloud" button', () => {
    expect(source).toMatch(/autoProvisionAttemptsRef = useRef\(0\)/)
    expect(source).toContain('#748: auto-provision on first real engagement')
  })

  it('the auto-provision effect only fires for a signed-in founder with a real company id', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/if \(!signedIn \|\| !companyId\) return/)
  })

  it('the auto-provision effect waits for the real provisioning status to be checked before firing', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/if \(!provision\.checked \|\| provision\.provisioned \|\| provision\.busy\) return/)
  })

  it('caps retries at a fixed maximum so a permanently-broken registration does not retry forever', () => {
    expect(source).toMatch(/MAX_AUTO_PROVISION_ATTEMPTS = 8/)
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/if \(autoProvisionAttemptsRef\.current >= MAX_AUTO_PROVISION_ATTEMPTS\) return/)
  })

  it('retries with backoff ONLY on the transient not_registered result, not on other errors', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/result === 'not_registered'/)
    expect(block).toMatch(/setTimeout\(/)
  })

  it('never schedules a second retry timer while one is already pending (no overlapping retries)', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/if \(autoProvisionTimerRef\.current\) return/)
  })

  it('cleans up any pending retry timer on unmount', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1400)
    expect(block).toMatch(/return \(\) => \{\s*if \(autoProvisionTimerRef\.current\)/)
  })

  it('the auto-provision effect calls the SAME provisionCompany() the manual button uses, not a separate/duplicated path', () => {
    const idx = source.indexOf('const autoProvisionAttemptsRef = useRef(0)')
    const block = source.slice(idx, idx + 1200)
    expect(block).toMatch(/await provisionCompany\(\)/)
  })

  it('provisionCompany itself still guards against concurrent/duplicate calls (busy || provisioned short-circuit)', () => {
    const idx = source.indexOf('const provisionCompany = async (): Promise<')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 400)
    expect(block).toMatch(/if \(provision\.busy \|\| provision\.provisioned\) return 'ok'/)
  })

  it('provisionCompany distinguishes the transient not_registered reason from a real error', () => {
    const idx = source.indexOf('const provisionCompany = async (): Promise<')
    const block = source.slice(idx, idx + 1400)
    expect(block).toMatch(/d\?\.reason === 'not_registered'/)
  })

  it('the provisioning-status GET now distinguishes "not yet checked" from "checked and confirmed unprovisioned" (checked flag)', () => {
    expect(source).toMatch(/checked: boolean/)
    expect(source).toMatch(/checked: true/)
  })

  it('surfaces the not_registered transient state honestly in the banner copy rather than implying breakage', () => {
    expect(source).toMatch(/provisionPending/)
    const idx = source.indexOf('data-testid="provisioning-banner"')
    const block = source.slice(idx, idx + 900)
    expect(block).toMatch(/still finishing your company's initial build/i)
  })
})
