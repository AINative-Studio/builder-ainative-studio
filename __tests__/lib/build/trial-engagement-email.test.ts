import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1607 — trial-engagement-email.ts: real-activity computation + the
 * honesty-rule content builder.
 */

const h = vi.hoisted(() => ({
  listWaitlist: vi.fn<(projectId: any) => Promise<any[]>>(async () => []),
  listVisitors: vi.fn<(projectId: any) => Promise<any[]>>(async () => []),
}))

vi.mock('@/lib/build/waitlist-metrics', () => ({ listWaitlist: h.listWaitlist }))
vi.mock('@/lib/build/visitor-metrics', () => ({ listVisitors: h.listVisitors }))

import { computeTrialActivitySince, renderTrialEngagementEmail, ctaUrl } from '@/lib/build/trial-engagement-email'

beforeEach(() => {
  vi.clearAllMocks()
  h.listWaitlist.mockResolvedValue([])
  h.listVisitors.mockResolvedValue([])
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('computeTrialActivitySince', () => {
  it('counts only waitlist/visitor entries strictly AFTER the since instant', async () => {
    h.listWaitlist.mockResolvedValue([
      { email: 'old@x.com', joinedAt: '2026-10-25T00:00:00Z' },
      { email: 'new@x.com', joinedAt: '2026-10-28T12:00:00Z' },
    ])
    h.listVisitors.mockResolvedValue([
      { path: '/', visitedAt: '2026-10-25T00:00:00Z' },
      { path: '/pricing', visitedAt: '2026-10-28T13:00:00Z' },
      { path: '/about', visitedAt: '2026-10-28T14:00:00Z' },
    ])
    const result = await computeTrialActivitySince('proj-1', '2026-10-27T00:00:00Z')
    expect(result.newSignups).toBe(1)
    expect(result.newVisits).toBe(2)
  })

  it('returns zero for genuinely zero new activity (never fabricated)', async () => {
    h.listWaitlist.mockResolvedValue([{ email: 'old@x.com', joinedAt: '2026-10-20T00:00:00Z' }])
    h.listVisitors.mockResolvedValue([])
    const result = await computeTrialActivitySince('proj-1', '2026-10-27T00:00:00Z')
    expect(result).toEqual({ newSignups: 0, newVisits: 0 })
  })

  it('degrades to 0 (never throws) when the waitlist read fails', async () => {
    h.listWaitlist.mockRejectedValue(new Error('network down'))
    h.listVisitors.mockResolvedValue([{ path: '/', visitedAt: '2026-10-28T12:00:00Z' }])
    const result = await computeTrialActivitySince('proj-1', '2026-10-27T00:00:00Z')
    expect(result.newSignups).toBe(0)
    expect(result.newVisits).toBe(1)
  })

  it('degrades to 0 (never throws) when the visitors read fails', async () => {
    h.listVisitors.mockRejectedValue(new Error('network down'))
    h.listWaitlist.mockResolvedValue([{ email: 'new@x.com', joinedAt: '2026-10-28T12:00:00Z' }])
    const result = await computeTrialActivitySince('proj-1', '2026-10-27T00:00:00Z')
    expect(result.newSignups).toBe(1)
    expect(result.newVisits).toBe(0)
  })
})

describe('renderTrialEngagementEmail', () => {
  it('HONESTY RULE: zero activity renders an honest "nothing new" message, never fabricated status', () => {
    const { subject, text, html } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: 'Acme', activity: { newSignups: 0, newVisits: 0 },
    })
    expect(subject).toContain('nothing new')
    expect(text).toContain('No new activity')
    expect(html).toContain('No new activity')
    // Never claims activity that didn't happen.
    expect(text).not.toMatch(/\d+ new (signup|visit)/)
  })

  it('reports real signup count when present', () => {
    const { subject, text } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: 'Acme', activity: { newSignups: 3, newVisits: 0 },
    })
    expect(subject).toContain('3 new signups')
    expect(text).toContain('3 new signups')
  })

  it('reports real visit count when present (singular form for exactly 1)', () => {
    const { subject } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: 'Acme', activity: { newSignups: 0, newVisits: 1 },
    })
    expect(subject).toContain('1 new visit today')
    expect(subject).not.toContain('1 new visits')
  })

  it('reports BOTH signups and visits together when both are present', () => {
    const { subject } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: 'Acme', activity: { newSignups: 2, newVisits: 5 },
    })
    expect(subject).toContain('2 new signups and 5 new visits')
  })

  it('includes a real, UTM-tagged CTA link distinct from winback\'s own campaign tag', () => {
    const { text } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: 'Acme', activity: { newSignups: 0, newVisits: 0 },
    })
    expect(text).toContain('utm_source=trial_engagement')
    expect(text).toContain('utm_campaign=daily_activity')
  })

  it('ctaUrl deep-links to the Live dashboard for the correct company slug', () => {
    const url = ctaUrl('acme')
    expect(url).toContain('screen=live')
    expect(url).toContain('company=acme')
  })

  it('escapes HTML-unsafe characters in the company name', () => {
    const { html } = renderTrialEngagementEmail({
      email: 'f@x.com', slug: 'acme', companyName: '<script>Acme</script>', activity: { newSignups: 0, newVisits: 0 },
    })
    expect(html).not.toContain('<script>Acme</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
