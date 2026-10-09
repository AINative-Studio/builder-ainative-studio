import { describe, it, expect } from 'vitest'
import { shouldRouteToCompaniesIndex } from '@/components/build/BuildApp'

/**
 * builder#1037, bounce path B — the second, independently reproduced route to
 * the same silent bounce, attributed by instrumenting the real dispatch site
 * and reading the origin back out of a live Chromium browser:
 *
 *   BOUNCE ORIGIN: [["buildapp-mycompanies","landing", ...]]
 *
 * ScreenRouter's "signed in WITH builder projects → load their dashboard"
 * effect guards itself with a re-check at fetch-resolve time
 * (`screenRef.current === 'landing'`), on the stated reasoning that "?screen=
 * deep links win (they move screen off 'landing' before this fetch resolves)".
 *
 * That reasoning has a real hole: ScreenRouter is a CHILD of BuildProvider, and
 * React runs child effects BEFORE parent effects. So this effect fires — and
 * can see its fetch resolve — before the deep-link effect's dispatches are ever
 * committed, at which point `screenRef.current` is still the reducer's initial
 * 'landing'. Reproduced in a real browser whenever /api/build/my-companies
 * answers fast enough (cached response, warm server); with the response
 * artificially delayed to 400ms+ the guard held and the founder stayed on Live,
 * which is exactly the kind of latency-dependent flakiness that made this
 * "sometimes" behavior.
 *
 * The URL is the authority the ref cannot be: it is correct from the very
 * first byte and no commit ordering can race it.
 */
describe('shouldRouteToCompaniesIndex (#1037 path B)', () => {
  const withCompanies = { companies: [{ slug: 'silo', name: 'silo' }] }

  it('does NOT route to the companies index when the URL is an explicit company deep link — even though the ref still reads "landing"', () => {
    expect(shouldRouteToCompaniesIndex({
      screen: 'landing', search: '?screen=live&company=silo', data: withCompanies,
    })).toBe(false)
  })

  it('does NOT route for an explicit workspace deep link either', () => {
    expect(shouldRouteToCompaniesIndex({
      screen: 'landing', search: '?screen=ws&company=silo', data: withCompanies,
    })).toBe(false)
  })

  it('STILL routes a signed-in founder with projects from a bare /build load — the Polsia-parity front door, unbroken', () => {
    expect(shouldRouteToCompaniesIndex({ screen: 'landing', search: '', data: withCompanies })).toBe(true)
  })

  it('still routes when the URL carries unrelated params (ad attribution, etc.)', () => {
    expect(shouldRouteToCompaniesIndex({
      screen: 'landing', search: '?gclid=abc123&utm_source=google', data: withCompanies,
    })).toBe(true)
  })

  it('still never routes a founder who has already navigated off the landing screen', () => {
    expect(shouldRouteToCompaniesIndex({ screen: 'intake', search: '', data: withCompanies })).toBe(false)
    expect(shouldRouteToCompaniesIndex({ screen: 'live', search: '', data: withCompanies })).toBe(false)
  })

  it('still never routes a founder with no projects (the new-user path stays on the funnel)', () => {
    expect(shouldRouteToCompaniesIndex({ screen: 'landing', search: '', data: { companies: [] } })).toBe(false)
  })

  it('still never routes on a failed/garbage my-companies response', () => {
    expect(shouldRouteToCompaniesIndex({ screen: 'landing', search: '', data: null })).toBe(false)
    expect(shouldRouteToCompaniesIndex({ screen: 'landing', search: '', data: {} })).toBe(false)
    expect(shouldRouteToCompaniesIndex({
      screen: 'landing', search: '', data: { companies: 'not-an-array' },
    })).toBe(false)
  })
})
