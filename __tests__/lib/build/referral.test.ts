import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  REFERRAL_CREDIT_AWARD,
  REFERRAL_COOKIE,
  referralCodeFor,
  referralCodeForSession,
  normalizeCode,
  isValidCode,
  referralLink,
  isSelfReferral,
  coerceReferral,
  computeStats,
  refCodeFromRequest,
  listReferralsByReferrer,
  findReferralByReferred,
  getReferralSummary,
  attributeSignup,
  creditReferrerOnSubscribe,
  type ReferralRecord,
} from '@/lib/build/referral'

/**
 * #59 — Refer & Earn store. Covers the pure core (deterministic code gen, code
 * validation, link build, self-referral guard, coercion, stats, cookie read) and
 * the ZeroDB-backed I/O (list/find/attribute/credit) by mocking global.fetch —
 * same node-env / per-test fetch-stub strategy as the task-store tests.
 */

const mkRow = (over: Partial<ReferralRecord> = {}): ReferralRecord => ({
  referrerKey: over.referrerKey ?? 'ada@example.com',
  code: over.code ?? referralCodeFor('ada@example.com'),
  referredKey: over.referredKey ?? 'bob@example.com',
  status: over.status ?? 'pending',
  creditsAward: over.creditsAward ?? 0,
  plan: over.plan ?? '',
  createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
  updatedAt: over.updatedAt ?? '2026-01-01T00:00:00Z',
})

// ---------- referralCodeFor (deterministic gen) ----------
describe('referralCodeFor (#59)', () => {
  it('is deterministic — same owner key → same code', () => {
    expect(referralCodeFor('ada@example.com')).toBe(referralCodeFor('ada@example.com'))
  })
  it('is case-insensitive on the input key', () => {
    expect(referralCodeFor('Ada@Example.com')).toBe(referralCodeFor('ada@example.com'))
  })
  it('produces a REF-prefixed, url-safe, bounded code', () => {
    const c = referralCodeFor('ada@example.com')
    expect(c.startsWith('REF')).toBe(true)
    expect(c).toMatch(/^[A-Z0-9]+$/)
    expect(c.length).toBeLessThanOrEqual(16)
    expect(c.length).toBeGreaterThanOrEqual(6)
  })
  it('differs for different owners (collision-light)', () => {
    const a = referralCodeFor('ada@example.com')
    const b = referralCodeFor('bob@example.com')
    const c = referralCodeFor('carol@example.com')
    expect(new Set([a, b, c]).size).toBe(3)
  })
  it('returns empty for a blank key', () => {
    expect(referralCodeFor('')).toBe('')
    expect(referralCodeFor('   ')).toBe('')
  })
  it('never leaks the raw email in the code', () => {
    expect(referralCodeFor('ada@example.com')).not.toContain('ada')
  })
})

// ---------- referralCodeForSession ----------
describe('referralCodeForSession (#59)', () => {
  it('mints a stable code for an authed user', () => {
    const code = referralCodeForSession({ user: { email: 'ada@example.com', type: 'regular' } })
    expect(code).toBe(referralCodeFor('ada@example.com'))
  })
  it('returns empty for a guest (no shareable identity)', () => {
    expect(referralCodeForSession({ user: { type: 'guest', email: 'guest-x@example.com' } })).toBe('')
    expect(referralCodeForSession(null)).toBe('')
  })
})

// ---------- normalizeCode / isValidCode ----------
describe('normalizeCode + isValidCode (#59)', () => {
  it('normalizes casing / strips junk / bounds length', () => {
    expect(normalizeCode('  ref-abc_123  ')).toBe('REFABC123')
    expect(normalizeCode('a'.repeat(50)).length).toBe(16)
    expect(normalizeCode(null)).toBe('')
  })
  it('validates a well-formed code and rejects malformed', () => {
    expect(isValidCode(referralCodeFor('ada@example.com'))).toBe(true)
    expect(isValidCode('REFAB')).toBe(false) // too short (< 6)
    expect(isValidCode('XYZ123')).toBe(false) // wrong prefix
    expect(isValidCode('')).toBe(false)
  })
})

// ---------- referralLink ----------
describe('referralLink (#59)', () => {
  it('builds a ?ref= link against the origin', () => {
    expect(referralLink('REFABC123', 'https://builder.ainative.studio')).toBe(
      'https://builder.ainative.studio/?ref=REFABC123',
    )
  })
  it('strips trailing slashes from the origin and normalizes the code', () => {
    expect(referralLink(' ref-abc ', 'https://x.com///')).toBe('https://x.com/?ref=REFABC')
  })
  it('returns empty for an empty code', () => {
    expect(referralLink('', 'https://x.com')).toBe('')
  })
  it('falls back to a default origin when none given', () => {
    expect(referralLink('REFABC123', '')).toContain('/?ref=REFABC123')
  })
})

// ---------- isSelfReferral ----------
describe('isSelfReferral (#59)', () => {
  it('flags the same key (case-insensitive)', () => {
    expect(isSelfReferral('Ada@Example.com', 'ada@example.com')).toBe(true)
  })
  it('does not flag different keys', () => {
    expect(isSelfReferral('ada@example.com', 'bob@example.com')).toBe(false)
  })
  it('is false when either side is blank', () => {
    expect(isSelfReferral('', 'bob@example.com')).toBe(false)
    expect(isSelfReferral('ada@example.com', '')).toBe(false)
  })
})

// ---------- coerceReferral ----------
describe('coerceReferral (#59)', () => {
  it('coerces a ZeroDB row (snake_case) into a record', () => {
    const r = coerceReferral({
      row_data: {
        referrer_key: 'Ada@Example.com', code: 'refabc123', referred_key: 'Bob@Example.com',
        status: 'credited', credits_award: 25, plan: 'pro',
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      },
    })
    expect(r).toEqual({
      referrerKey: 'ada@example.com', code: 'REFABC123', referredKey: 'bob@example.com',
      status: 'credited', creditsAward: 25, plan: 'pro',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    })
  })
  it('zeroes the award while pending regardless of stored value', () => {
    const r = coerceReferral({ referrer_key: 'a@a.co', referred_key: 'b@b.co', status: 'pending', credits_award: 25 })
    expect(r?.creditsAward).toBe(0)
    expect(r?.status).toBe('pending')
  })
  it('fills a code when missing (derived from referrer key)', () => {
    const r = coerceReferral({ referrer_key: 'ada@example.com', referred_key: 'bob@example.com' })
    expect(r?.code).toBe(referralCodeFor('ada@example.com'))
  })
  it('drops rows missing the required keys', () => {
    expect(coerceReferral(null)).toBeNull()
    expect(coerceReferral({ referrer_key: 'a@a.co' })).toBeNull()
    expect(coerceReferral({ referred_key: 'b@b.co' })).toBeNull()
  })
})

// ---------- computeStats ----------
describe('computeStats (#59)', () => {
  it('derives friends/earned/pending from the ledger', () => {
    const rows = [
      mkRow({ status: 'credited', creditsAward: 25 }),
      mkRow({ status: 'credited', creditsAward: 25, referredKey: 'c@c.co' }),
      mkRow({ status: 'pending', referredKey: 'd@d.co' }),
    ]
    expect(computeStats(rows)).toEqual({ friendsReferred: 3, creditsEarned: 50, creditsPending: 1 })
  })
  it('is uncapped — sums arbitrarily many credited rows', () => {
    const rows = Array.from({ length: 40 }, (_, i) => mkRow({ status: 'credited', creditsAward: 25, referredKey: `u${i}@x.co` }))
    expect(computeStats(rows)).toEqual({ friendsReferred: 40, creditsEarned: 1000, creditsPending: 0 })
  })
  it('handles an empty / non-array input', () => {
    expect(computeStats([])).toEqual({ friendsReferred: 0, creditsEarned: 0, creditsPending: 0 })
    expect(computeStats(undefined as any)).toEqual({ friendsReferred: 0, creditsEarned: 0, creditsPending: 0 })
  })
})

// ---------- refCodeFromRequest ----------
describe('refCodeFromRequest (#59)', () => {
  const req = (cookie: string) => new Request('https://x.com', { headers: { cookie } })
  it('reads a valid code from the ax_ref cookie', () => {
    const code = referralCodeFor('ada@example.com')
    expect(refCodeFromRequest(req(`${REFERRAL_COOKIE}=${code}`))).toBe(code)
  })
  it('returns empty when the cookie is missing or invalid', () => {
    expect(refCodeFromRequest(req(''))).toBe('')
    expect(refCodeFromRequest(req(`${REFERRAL_COOKIE}=XYZ`))).toBe('')
  })
})

// ---------- I/O helpers ----------
function mockFetch(impl: (url: string, init?: any) => { ok: boolean; status?: number; json?: () => any }) {
  const fn = vi.fn(async (url: string, init?: any) => {
    const r = impl(url, init)
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => (r.json ? r.json() : {}) } as any
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('listReferralsByReferrer (#59)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns [] for a blank key without hitting the network', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await listReferralsByReferrer('')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
  it('maps + filters ZeroDB rows', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [
      { row_data: { referrer_key: 'ada@example.com', referred_key: 'b@b.co', status: 'credited', credits_award: 25 } },
      { row_data: { referrer_key: 'ada@example.com' } }, // dropped (no referred key)
    ] }) }))
    const rows = await listReferralsByReferrer('ada@example.com')
    expect(rows).toHaveLength(1)
    expect(rows[0].referredKey).toBe('b@b.co')
  })
  it('returns [] on a network error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await listReferralsByReferrer('ada@example.com')).toEqual([])
  })
})

describe('findReferralByReferred (#59)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns the single matching row', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [{ row_data: { referrer_key: 'a@a.co', referred_key: 'b@b.co', status: 'pending' } }] }) }))
    const r = await findReferralByReferred('b@b.co')
    expect(r?.referredKey).toBe('b@b.co')
  })
  it('returns null when there is no match', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    expect(await findReferralByReferred('none@x.co')).toBeNull()
  })
  it('returns null for a blank key', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await findReferralByReferred('')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('attributeSignup (#59)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const code = referralCodeFor('ada@example.com')

  it('rejects an invalid code without a write', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await attributeSignup('XYZ', 'bob@example.com')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
  it('rejects a self-referral', async () => {
    // referrer key resolved as the same as referred → rejected before any write
    const fn = mockFetch(() => ({ ok: true }))
    expect(await attributeSignup(code, 'ada@example.com', 'ada@example.com')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })
  it('creates a PENDING referral for a valid attribution', async () => {
    // first the idempotency lookup (empty), then the create.
    let call = 0
    mockFetch((_u, init) => {
      call++
      if (call === 1) return { ok: true, json: () => ({ data: [] }) } // findReferralByReferred
      return { ok: true, json: () => ({ id: 'r1' }) } // create
    })
    const rec = await attributeSignup(code, 'bob@example.com', 'ada@example.com')
    expect(rec).not.toBeNull()
    expect(rec?.status).toBe('pending')
    expect(rec?.referredKey).toBe('bob@example.com')
    expect(rec?.creditsAward).toBe(0)
  })
  it('is idempotent — returns the existing row without a second write', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [{ row_data: { referrer_key: 'ada@example.com', referred_key: 'bob@example.com', status: 'pending' } }] }) }))
    const rec = await attributeSignup(code, 'bob@example.com', 'ada@example.com')
    expect(rec?.referredKey).toBe('bob@example.com')
    // only the lookup fired, not a create (single POST to /query).
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('returns null on a write failure', async () => {
    let call = 0
    mockFetch(() => {
      call++
      if (call === 1) return { ok: true, json: () => ({ data: [] }) }
      return { ok: false, status: 500 }
    })
    expect(await attributeSignup(code, 'bob@example.com', 'ada@example.com')).toBeNull()
  })
})

describe('creditReferrerOnSubscribe (#59)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('credits a pending referral and returns the award', async () => {
    let call = 0
    const fn = mockFetch(() => {
      call++
      if (call === 1) return { ok: true, json: () => ({ data: [{ row_data: { referrer_key: 'ada@example.com', referred_key: 'bob@example.com', status: 'pending' } }] }) }
      return { ok: true, json: () => ({ updated: 1 }) }
    })
    const awarded = await creditReferrerOnSubscribe('bob@example.com', 'pro')
    expect(awarded).toBe(REFERRAL_CREDIT_AWARD)
    // lookup + update
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[1][1].method).toBe('PUT')
  })
  it('returns 0 when the subscriber was not referred', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    expect(await creditReferrerOnSubscribe('nobody@x.co', 'pro')).toBe(0)
    expect(fn).toHaveBeenCalledTimes(1) // only the lookup — no write
  })
  it('is idempotent — an already-credited referral is not re-paid', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [{ row_data: { referrer_key: 'a@a.co', referred_key: 'bob@example.com', status: 'credited', credits_award: 25 } }] }) }))
    expect(await creditReferrerOnSubscribe('bob@example.com', 'pro')).toBe(0)
    expect(fn).toHaveBeenCalledTimes(1) // lookup only, no second PUT
  })
  it('returns 0 for a blank key', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await creditReferrerOnSubscribe('', 'pro')).toBe(0)
    expect(fn).not.toHaveBeenCalled()
  })
  it('returns 0 on a store failure during the update (never throws)', async () => {
    let call = 0
    mockFetch(() => {
      call++
      if (call === 1) return { ok: true, json: () => ({ data: [{ row_data: { referrer_key: 'a@a.co', referred_key: 'bob@example.com', status: 'pending' } }] }) }
      return { ok: false, status: 500 }
    })
    expect(await creditReferrerOnSubscribe('bob@example.com', 'pro')).toBe(0)
  })
})

describe('getReferralSummary (#59)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns code + link + derived stats for an authed user', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [
      { row_data: { referrer_key: 'ada@example.com', referred_key: 'b@b.co', status: 'credited', credits_award: 25 } },
      { row_data: { referrer_key: 'ada@example.com', referred_key: 'c@c.co', status: 'pending' } },
    ] }) }))
    const s = await getReferralSummary({ user: { email: 'ada@example.com', type: 'regular' } }, 'https://x.com')
    expect(s.code).toBe(referralCodeFor('ada@example.com'))
    expect(s.link).toBe(`https://x.com/?ref=${s.code}`)
    expect(s.stats).toEqual({ friendsReferred: 2, creditsEarned: 25, creditsPending: 1 })
  })
  it('returns empty (no code/link) for a guest without a network call', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const s = await getReferralSummary({ user: { type: 'guest', email: 'guest-x@example.com' } }, 'https://x.com')
    expect(s).toEqual({ code: '', link: '', stats: { friendsReferred: 0, creditsEarned: 0, creditsPending: 0 } })
    expect(fn).not.toHaveBeenCalled()
  })
})
