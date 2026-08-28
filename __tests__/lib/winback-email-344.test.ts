import { describe, it, expect, vi } from 'vitest'

// No live ZeroDB/Resend in unit tests — mock the registry away so importing the
// module doesn't touch the network. We test the PURE exported logic.
vi.mock('@/lib/build/app-registry', () => ({
  listAllApps: vi.fn(async () => []),
}))

import { selectDormantOwners, renderWinbackEmail, ctaUrl } from '@/lib/growth/winback-email'
import type { AppEntry } from '@/lib/build/app-registry'

const NOW = new Date('2026-08-28T00:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

function app(p: Partial<AppEntry>): AppEntry {
  return { slug: 's', chatId: 'c', createdAt: new Date(NOW - 30 * DAY).toISOString(), ...p }
}

describe('selectDormantOwners (#344)', () => {
  it('selects an owner whose newest company is older than 7 days', () => {
    const apps = [app({ slug: 'aerosol', name: 'Aerosol', ownerEmail: 'toby@x.com', createdAt: new Date(NOW - 10 * DAY).toISOString() })]
    const t = selectDormantOwners(apps, NOW)
    expect(t).toHaveLength(1)
    expect(t[0].email).toBe('toby@x.com')
    expect(t[0].companyName).toBe('Aerosol')
  })

  it('excludes a RECENTLY-active owner (company < 7 days old)', () => {
    const apps = [app({ ownerEmail: 'fresh@x.com', createdAt: new Date(NOW - 2 * DAY).toISOString() })]
    expect(selectDormantOwners(apps, NOW)).toHaveLength(0)
  })

  it('never emails anonymous/unowned companies (no ownerEmail)', () => {
    const apps = [app({ ownerEmail: undefined, createdAt: new Date(NOW - 30 * DAY).toISOString() })]
    expect(selectDormantOwners(apps, NOW)).toHaveLength(0)
  })

  it('skips deleted companies', () => {
    const apps = [app({ ownerEmail: 'del@x.com', lifecycleStatus: 'deleted', createdAt: new Date(NOW - 30 * DAY).toISOString() })]
    expect(selectDormantOwners(apps, NOW)).toHaveLength(0)
  })

  it('one target per owner — references their most-recent company', () => {
    const apps = [
      app({ slug: 'old', name: 'Old Co', ownerEmail: 'multi@x.com', createdAt: new Date(NOW - 40 * DAY).toISOString() }),
      app({ slug: 'new', name: 'New Co', ownerEmail: 'multi@x.com', createdAt: new Date(NOW - 12 * DAY).toISOString() }),
    ]
    const t = selectDormantOwners(apps, NOW)
    expect(t).toHaveLength(1)
    expect(t[0].companyName).toBe('New Co')
  })

  it('is case-insensitive on ownerEmail (dedupes MiXeD case)', () => {
    const apps = [
      app({ slug: 'a', ownerEmail: 'Toby@X.com', createdAt: new Date(NOW - 40 * DAY).toISOString() }),
      app({ slug: 'b', ownerEmail: 'toby@x.com', createdAt: new Date(NOW - 20 * DAY).toISOString() }),
    ]
    expect(selectDormantOwners(apps, NOW)).toHaveLength(1)
  })
})

describe('renderWinbackEmail (#344)', () => {
  const t = { email: 'toby@x.com', slug: 'aerosol', companyName: 'Aerosol', tagline: 'Street art gallery' }

  it('names the company in subject + body and has a single CTA deep link', () => {
    const { subject, html, text } = renderWinbackEmail(t)
    expect(subject).toContain('Aerosol')
    expect(html).toContain('Aerosol')
    expect(text).toContain('Aerosol')
    expect(html).toContain(ctaUrl('aerosol'))
    // single primary CTA (one "Jump back in" button)
    expect((html.match(/Jump back in/g) || []).length).toBe(1)
  })

  it('CTA is UTM-tagged and deep-links to the company', () => {
    const u = ctaUrl('aerosol')
    expect(u).toContain('utm_source=winback')
    expect(u).toContain('utm_campaign=jump_back_in')
    expect(u).toContain('company=aerosol')
  })

  it('includes an unsubscribe link (email URL-encoded, decodes back on the route)', () => {
    const { html } = renderWinbackEmail(t)
    expect(html.toLowerCase()).toContain('unsubscribe')
    // URL.searchParams encodes @ → %40; the route's searchParams.get() decodes it back.
    expect(html).toContain('unsubscribe=toby%40x.com')
    expect(decodeURIComponent('toby%40x.com')).toBe('toby@x.com')
  })

  it('escapes HTML in the company name (no injection)', () => {
    const { html } = renderWinbackEmail({ ...t, companyName: '<script>x</script>' })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it("uses Cody's plain voice — no hype exclamation marks in the body copy", () => {
    const { text } = renderWinbackEmail(t)
    expect(text).not.toContain('!')
  })
})
