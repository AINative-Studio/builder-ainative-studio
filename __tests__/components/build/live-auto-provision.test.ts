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
 * Source-level assertions (this repo's existing pattern for Live.tsx — see
 * enterprise-billing-routing.test.ts) since Live.tsx has heavy
 * context/session/hook dependencies that make full component rendering
 * impractical here. Idempotency of the underlying /api/build/provision
 * handler itself is covered by lib/build tests + this file's assertions that
 * the trigger only fires once and reuses the same guarded provisionCompany().
 */
describe('Live screen — auto-provision on first engagement (#748)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('has a dedicated auto-provision effect distinct from the manual "Provision cloud" button', () => {
    expect(source).toMatch(/autoProvisionAttempted = useRef\(false\)/)
    expect(source).toContain('#748: auto-provision on first real engagement')
  })

  it('the auto-provision effect only fires for a signed-in founder with a real company id', () => {
    const idx = source.indexOf('const autoProvisionAttempted = useRef(false)')
    const block = source.slice(idx, idx + 700)
    expect(block).toMatch(/if \(!signedIn \|\| !companyId\) return/)
  })

  it('the auto-provision effect waits for the real provisioning status to be checked before firing', () => {
    const idx = source.indexOf('const autoProvisionAttempted = useRef(false)')
    const block = source.slice(idx, idx + 700)
    expect(block).toMatch(/if \(!provision\.checked \|\| provision\.provisioned \|\| provision\.busy\) return/)
  })

  it('the auto-provision effect fires at most once via a ref guard (idempotent on re-render/re-invocation)', () => {
    const idx = source.indexOf('const autoProvisionAttempted = useRef(false)')
    const block = source.slice(idx, idx + 700)
    expect(block).toMatch(/if \(autoProvisionAttempted\.current\) return/)
    expect(block).toMatch(/autoProvisionAttempted\.current = true/)
  })

  it('the auto-provision effect calls the SAME provisionCompany() the manual button uses, not a separate/duplicated path', () => {
    const idx = source.indexOf('const autoProvisionAttempted = useRef(false)')
    const block = source.slice(idx, idx + 700)
    expect(block).toMatch(/provisionCompany\(\)/)
  })

  it('provisionCompany itself still guards against concurrent/duplicate calls (busy || provisioned short-circuit)', () => {
    const idx = source.indexOf('const provisionCompany = async () => {')
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 300)
    expect(block).toMatch(/if \(provision\.busy \|\| provision\.provisioned\) return/)
  })

  it('the provisioning-status GET now distinguishes "not yet checked" from "checked and confirmed unprovisioned" (checked flag)', () => {
    expect(source).toMatch(/checked: boolean/)
    expect(source).toMatch(/checked: true/)
  })
})
