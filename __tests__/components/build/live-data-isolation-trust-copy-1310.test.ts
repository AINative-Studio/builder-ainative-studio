import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #1310 — Builder has REAL per-company backend isolation
 * (lib/build/company-zerodb-credentials.ts: a dedicated, project-scoped
 * ZeroDB data-plane key per company, never a shared pool — see that file's
 * own doc comment on the #806 bug this fixed, where a shared key caused
 * cross-tenant 403s). That real fact has never been surfaced to the founder
 * anywhere in the product.
 *
 * This is a copy-only addition: one honest, factual trust line placed in the
 * "Website & infrastructure" card (components/build/screens/Live.tsx),
 * right alongside the EXISTING real "Own ZeroDB project" line (#1465-ish) --
 * the one place that already states real per-company provisioning facts.
 * Gated on `provision.provisioned` so it is never shown before the company
 * genuinely has its own isolated project (same honesty gate the existing
 * "Own ZeroDB project" line already uses).
 *
 * No invented compliance claims (no "enterprise-grade", no SOC2) -- only
 * what's actually true: a dedicated, isolated database per company.
 */
describe('Live.tsx surfaces honest per-company data-isolation trust copy (#1310)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/Live.tsx'),
    'utf8',
  )

  it('states the real per-company isolation fact near the provisioned infra line', () => {
    // Must mention isolation/dedicated-per-company framing in plain language.
    expect(source).toMatch(/isolat(ed|ion)/i)
  })

  it('does not fabricate compliance claims not backed by real evidence', () => {
    expect(source.toLowerCase()).not.toContain('soc2')
    expect(source.toLowerCase()).not.toContain('soc 2')
    expect(source.toLowerCase()).not.toContain('enterprise-grade')
    expect(source.toLowerCase()).not.toContain('enterprise grade')
    expect(source.toLowerCase()).not.toContain('hipaa')
    expect(source.toLowerCase()).not.toContain('gdpr compliant')
  })

  it('places the isolation line inside the provision.provisioned-gated infra block (never shown before real provisioning)', () => {
    const match = source.match(/\{provision\.provisioned && \(\s*<p className="m-mono m-metric-note">([\s\S]*?)<\/p>\s*\)\}/)
    expect(match).toBeTruthy()
    expect(match![1]).toMatch(/isolat(ed|ion)/i)
  })
})
