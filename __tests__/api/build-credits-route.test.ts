import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #324 GR-15 — /api/build/credits route integration:
 *   - POST derives the composed primitives SERVER-side from the idea via the same
 *     deterministic selectPrimitives the composition pipeline uses; a client-sent
 *     primitives list is ignored,
 *   - the 402 gate uses the EFFECTIVE (bonus-inclusive) status from build-credits,
 *   - the response carries an honest ecosystem block: message only when the bonus
 *     actually raised the runway (before→after delta), silent otherwise.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  getBuildCreditStatus: vi.fn(),
  recordBuild: vi.fn(),
  recordPreviewReached: vi.fn(),
  // Value guarantee (#310/#311): the route consults these when the raw status is
  // blocked. Default: preview already reached → the guarantee does NOT open the
  // gate (pass the raw blocked status through), preserving these 402 tests.
  hasReachedPreview: vi.fn(async () => true),
  applyValueGuarantee: vi.fn((raw: any, reached: boolean) =>
    reached ? raw : { ...raw, allowed: true, valueGuarantee: true },
  ),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/build/build-credits', () => ({
  getBuildCreditStatus: h.getBuildCreditStatus,
  recordBuild: h.recordBuild,
  recordPreviewReached: h.recordPreviewReached,
  hasReachedPreview: h.hasReachedPreview,
  applyValueGuarantee: h.applyValueGuarantee,
}))

import { GET, POST } from '@/app/api/build/credits/route'
import { selectPrimitives } from '@/lib/build/primitive-catalog'
import { ecosystemBonusMessage } from '@/lib/build/ecosystem-bonus'

const SESSION = { user: { email: 'founder@example.com' }, accessToken: 'tok' }

// An idea that deterministically composes >= 2 ecosystem primitives
// (invoice/billing → ZeroInvoice; crm/sales/pipeline → ZeroPipeline).
const ECO_IDEA = 'An invoicing tool with a CRM sales pipeline for freelancers'
// An idea with no ecosystem trigger words — substrate only.
const PLAIN_IDEA = 'A simple journal'

function status(overrides: Record<string, unknown> = {}) {
  return {
    used: 0, limit: 3, baseLimit: 3, ecosystemBonus: 0,
    remaining: 3, allowed: true, unlimited: false,
    ...overrides,
  }
}

function post(body: unknown) {
  return POST(new Request('http://localhost/api/build/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue(SESSION)
  h.getPlanStatus.mockReset().mockResolvedValue({ tier: 'hobbyist' })
  h.getBuildCreditStatus.mockReset()
  h.recordBuild.mockReset().mockResolvedValue(true)
})

describe('GET /api/build/credits', () => {
  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('surfaces the bonus-inclusive status (baseLimit + ecosystemBonus)', async () => {
    h.getBuildCreditStatus.mockResolvedValue(status({ ecosystemBonus: 1, limit: 4, used: 3, remaining: 1 }))
    const res = await GET()
    const body = await res.json()
    expect(body.limit).toBe(4)
    expect(body.baseLimit).toBe(3)
    expect(body.ecosystemBonus).toBe(1)
    expect(body.tier).toBe('hobbyist')
  })
})

describe('POST /api/build/credits (#324 GR-15)', () => {
  it('402 when the EFFECTIVE (bonus-inclusive) allowance is exhausted — nothing recorded', async () => {
    h.getBuildCreditStatus.mockResolvedValue(status({ used: 4, limit: 4, ecosystemBonus: 1, remaining: 0, allowed: false }))
    const res = await post({ slug: 'x', idea: ECO_IDEA })
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.error).toBe('build_limit_reached')
    expect(h.recordBuild).not.toHaveBeenCalled()
  })

  it('derives primitives server-side from the idea (selectPrimitives) and records them', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status()) // gate check
      .mockResolvedValueOnce(status({ used: 1, ecosystemBonus: 1, limit: 4, remaining: 3 })) // re-read
    const res = await post({ slug: 'inv-app', idea: ECO_IDEA, track: 'company' })
    expect(res.status).toBe(200)

    const expected = selectPrimitives(ECO_IDEA, 'company').names
    expect(h.recordBuild).toHaveBeenCalledWith('founder@example.com', 'inv-app', expected)
    // Sanity: the deterministic selection really composes the two ecosystem primitives.
    expect(expected).toContain('ZeroInvoice')
    expect(expected).toContain('ZeroPipeline')
  })

  it('surfaces viaDripToken honestly when the build was only allowed via the daily drip (#450)', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status({ used: 3, remaining: 1, viaDripToken: true })) // gate check
      .mockResolvedValueOnce(status({ used: 4, remaining: 0 })) // re-read after recording
    const res: any = await post({ slug: 'drip-app', idea: PLAIN_IDEA })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.viaDripToken).toBe(true)
    expect(h.recordBuild).toHaveBeenCalled() // the drip build IS recorded, same as any other
  })

  it('does not falsely claim viaDripToken when the build was within the normal allowance', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status()) // normal, no drip flag
      .mockResolvedValueOnce(status({ used: 1, remaining: 2 }))
    const res: any = await post({ slug: 'normal-app', idea: PLAIN_IDEA })
    const json = await res.json()
    expect(json.viaDripToken).toBeFalsy()
  })

  it('IGNORES a client-sent primitives list — the bonus is never client-decided', async () => {
    h.getBuildCreditStatus.mockResolvedValue(status())
    await post({
      slug: 'plain', idea: PLAIN_IDEA,
      primitives: ['ZeroInvoice', 'ZeroPipeline', 'ZeroCommerce', 'ZeroVoice'], // attempted inflation
    })
    const recorded = h.recordBuild.mock.calls[0][2] as string[]
    expect(recorded).toEqual(selectPrimitives(PLAIN_IDEA, 'company').names)
    expect(recorded).not.toContain('ZeroInvoice')
  })

  it('returns the honest ecosystem message when the bonus actually raised the runway', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status({ ecosystemBonus: 0 }))
      .mockResolvedValueOnce(status({ used: 1, ecosystemBonus: 1, limit: 4, remaining: 3 }))
    const res = await post({ slug: 'inv-app', idea: ECO_IDEA, track: 'company' })
    const body = await res.json()

    expect(body.ecosystem.bonusEarned).toBe(1)
    expect(body.ecosystem.composed).toBeGreaterThanOrEqual(2)
    expect(body.ecosystem.message).toBe(ecosystemBonusMessage(body.ecosystem.composed, 1))
    expect(body.ecosystem.message).toContain('I extended your free runway by 1 build.')
  })

  it('stays silent (empty message) when nothing was earned', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status())
      .mockResolvedValueOnce(status({ used: 1, remaining: 2 }))
    const res = await post({ slug: 'plain', idea: PLAIN_IDEA })
    const body = await res.json()
    expect(body.ecosystem.bonusEarned).toBe(0)
    expect(body.ecosystem.message).toBe('')
  })

  it('stays silent once the bonus cap is hit (no before→after delta) — never a false promise', async () => {
    h.getBuildCreditStatus
      .mockResolvedValueOnce(status({ used: 4, ecosystemBonus: 2, limit: 5, remaining: 1 }))
      .mockResolvedValueOnce(status({ used: 5, ecosystemBonus: 2, limit: 5, remaining: 0, allowed: false }))
    const res = await post({ slug: 'inv-app', idea: ECO_IDEA })
    const body = await res.json()
    expect(body.ecosystem.bonusEarned).toBe(0)
    expect(body.ecosystem.message).toBe('')
  })

  it('tolerates a missing idea (records an empty primitives list)', async () => {
    h.getBuildCreditStatus.mockResolvedValue(status())
    const res = await post({ slug: 'no-idea' })
    expect(res.status).toBe(200)
    expect(h.recordBuild).toHaveBeenCalledWith('founder@example.com', 'no-idea', [])
    const body = await res.json()
    expect(body.ecosystem.composed).toBe(0)
    expect(body.ecosystem.message).toBe('')
  })

  it('401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await post({ slug: 'x' })
    expect(res.status).toBe(401)
    expect(h.recordBuild).not.toHaveBeenCalled()
  })

  it('401 when the session has no email', async () => {
    h.auth.mockResolvedValue({ user: {} })
    const res = await post({ slug: 'x' })
    expect(res.status).toBe(401)
  })

  it('plan lookup failure falls back to the free tier (never over-grants)', async () => {
    h.getPlanStatus.mockRejectedValue(new Error('core down'))
    h.getBuildCreditStatus.mockResolvedValue(status())
    const res = await post({ slug: 'x', idea: PLAIN_IDEA })
    expect(res.status).toBe(200)
    expect(h.getBuildCreditStatus).toHaveBeenCalledWith('founder@example.com', 'hobbyist')
  })

  it('no access token → free tier without calling the plan service', async () => {
    h.auth.mockResolvedValue({ user: { email: 'founder@example.com' } })
    h.getBuildCreditStatus.mockResolvedValue(status())
    await post({ slug: 'x' })
    expect(h.getPlanStatus).not.toHaveBeenCalled()
    expect(h.getBuildCreditStatus).toHaveBeenCalledWith('founder@example.com', 'hobbyist')
  })

  it('a malformed JSON body is tolerated (empty idea, build still recorded)', async () => {
    h.getBuildCreditStatus.mockResolvedValue(status())
    const res = await POST(new Request('http://localhost/api/build/credits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json',
    }))
    expect(res.status).toBe(200)
    expect(h.recordBuild).toHaveBeenCalledWith('founder@example.com', undefined, [])
  })
})
