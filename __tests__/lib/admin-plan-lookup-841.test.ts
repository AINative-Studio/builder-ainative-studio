import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #841 — cross-account plan lookup by email.
 *
 * This is the ONLY way Builder can answer "is this account paid?" without the
 * account's own bearer token, so it is what makes an offline backfill sweep
 * possible. It is also the single point where a mistake would attribute one
 * founder's paid plan to a different company and enroll the wrong customer —
 * hence the exact-match and fail-closed tests below.
 */

vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'sk_test_key' }))

import { fetchPlanByEmail } from '@/lib/ainative/admin-plan-lookup'

const ok = (body: unknown) => ({
  ok: true, status: 200, json: async () => body,
})

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

describe('#841 fetchPlanByEmail — happy path', () => {
  it('returns core\'s plan for an exact email match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      users: [{ email: 'amador@selfpreneur.com', plan: 'pro' }], total: 1,
    })))

    const r = await fetchPlanByEmail('amador@selfpreneur.com')

    expect(r).toMatchObject({ plan: 'pro', verified: true })
  })

  it('matches case-insensitively and lowercases the plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      users: [{ email: 'Founder@Example.COM', plan: 'Business' }],
    })))

    const r = await fetchPlanByEmail('founder@example.com')

    expect(r).toMatchObject({ plan: 'business', verified: true })
  })

  it('reports a genuinely free account as verified-and-free (not as an error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ users: [{ email: 'f@x.com', plan: 'free' }] })))

    const r = await fetchPlanByEmail('f@x.com')

    expect(r).toMatchObject({ plan: 'free', verified: true })
  })

  it('sends the admin lookup with the service key and an encoded email', async () => {
    const spy = vi.fn(async () => ok({ users: [{ email: 'a+b@x.com', plan: 'pro' }] }))
    vi.stubGlobal('fetch', spy)

    await fetchPlanByEmail('a+b@x.com')

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/api/v1/admin/users?email=')
    expect(url).toContain(encodeURIComponent('a+b@x.com'))
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_key')
  })
})

describe('#841 fetchPlanByEmail — exact-match safety (core filters by SUBSTRING)', () => {
  it('never attributes a different account\'s plan on a substring match', async () => {
    // Core's ?email= is a substring filter: asking for "amador@selfpreneur.com"
    // could surface other addresses. Only an exact match may be trusted.
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      users: [{ email: 'someone-else@other.com', plan: 'enterprise' }],
    })))

    const r = await fetchPlanByEmail('amador@selfpreneur.com')

    expect(r.verified).toBe(false)
    expect(r.plan).toBeNull()
    expect(r.reason).toBe('no_matching_user')
  })

  it('picks the exact row out of a multi-row substring response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      users: [
        { email: 'amador@selfpreneur.com.evil.com', plan: 'enterprise' },
        { email: 'amador@selfpreneur.com', plan: 'pro' },
        { email: 'xamador@selfpreneur.com', plan: 'business' },
      ],
    })))

    const r = await fetchPlanByEmail('amador@selfpreneur.com')

    expect(r).toMatchObject({ plan: 'pro', verified: true })
  })

  it('refuses to guess when two rows share the same email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      users: [{ email: 'dup@x.com', plan: 'free' }, { email: 'dup@x.com', plan: 'enterprise' }],
    })))

    const r = await fetchPlanByEmail('dup@x.com')

    expect(r).toMatchObject({ verified: false, plan: null, reason: 'ambiguous_match' })
  })

  it('reports a genuinely unknown account as unverified, not as unpaid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ users: [], total: 0 })))

    const r = await fetchPlanByEmail('nobody@nowhere.invalid')

    expect(r).toMatchObject({ verified: false, reason: 'no_matching_user' })
  })
})

describe('#841 fetchPlanByEmail — fails closed and distinguishably', () => {
  it('returns unverified (never a plan) on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))

    const r = await fetchPlanByEmail('a@b.com')

    expect(r).toMatchObject({ verified: false, plan: null, reason: 'http_403' })
  })

  it('returns unverified on a network/timeout failure — never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))

    const r = await fetchPlanByEmail('a@b.com')

    expect(r.verified).toBe(false)
    expect(r.plan).toBeNull()
  })

  it('returns unverified on a malformed response body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ nope: true })))

    const r = await fetchPlanByEmail('a@b.com')

    expect(r).toMatchObject({ verified: false, reason: 'malformed_response' })
  })

  it('returns unverified when core omits the plan field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ users: [{ email: 'a@b.com' }] })))

    const r = await fetchPlanByEmail('a@b.com')

    expect(r).toMatchObject({ verified: false, reason: 'no_plan_field' })
  })

  it('rejects a malformed email without making a network call', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)

    for (const bad of ['', '   ', 'not-an-email']) {
      const r = await fetchPlanByEmail(bad)
      expect(r).toMatchObject({ verified: false, reason: 'invalid_email' })
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('a "could not verify" result is shaped differently from a confirmed free account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const failed = await fetchPlanByEmail('a@b.com')

    vi.stubGlobal('fetch', vi.fn(async () => ok({ users: [{ email: 'a@b.com', plan: 'free' }] })))
    const free = await fetchPlanByEmail('a@b.com')

    // The #762 lesson: a caller must be able to tell these apart.
    expect(failed.verified).toBe(false)
    expect(free.verified).toBe(true)
    expect(free.plan).toBe('free')
  })
})
