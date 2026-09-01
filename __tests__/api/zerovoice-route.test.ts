import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #415 — POST /api/build/zerovoice (explicit, founder-triggered "get a
 * phone number" action).
 *
 * Properties under test:
 *  - disabled by default (ZEROVOICE_PROVISION_ENABLED unset) — never calls
 *    any collaborator, always returns reason:'disabled';
 *  - requires a slug (400 on missing);
 *  - requires sign-in (reason:'signin' when anonymous);
 *  - requires a PAID tier (reason:'tier' for hobbyist/free);
 *  - a paid, signed-in founder on an unprovisioned company gets a real
 *    number, and it's persisted via setAppZeroVoice;
 *  - an already-provisioned company short-circuits to the existing number
 *    WITHOUT calling provisionZeroVoiceNumber again (idempotent at the
 *    route layer too, on top of the client's own idempotency guard);
 *  - a provisioning failure is surfaced honestly, never fabricated as success.
 * All collaborators are mocked; no real network/Twilio call is made.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlanStatus: vi.fn(),
  resolveApp: vi.fn(),
  setAppZeroVoice: vi.fn(async () => true),
  provisionZeroVoiceNumber: vi.fn(),
  zeroVoiceProvisionEnabled: vi.fn(() => true),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: h.getPlanStatus }))
vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  setAppZeroVoice: h.setAppZeroVoice,
}))
vi.mock('@/lib/build/zerovoice', () => ({
  provisionZeroVoiceNumber: h.provisionZeroVoiceNumber,
  zeroVoiceProvisionEnabled: h.zeroVoiceProvisionEnabled,
}))

import { POST } from '@/app/api/build/zerovoice/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const UNPROVISIONED = { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }
const PROVISIONED = { ...UNPROVISIONED, zerovoiceProvisioned: true, zerovoiceNumberId: 'num-existing', zerovoiceE164: '+15551234567' }

beforeEach(() => {
  vi.clearAllMocks()
  h.zeroVoiceProvisionEnabled.mockReturnValue(true)
  h.auth.mockResolvedValue({ accessToken: 'tok', user: { email: 'f@x.com' } })
  h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
  h.resolveApp.mockResolvedValue(UNPROVISIONED)
  h.setAppZeroVoice.mockResolvedValue(true)
})

describe('POST /api/build/zerovoice (#415)', () => {
  it('is disabled by default — never calls any collaborator', async () => {
    h.zeroVoiceProvisionEnabled.mockReturnValue(false)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'disabled' }))
    expect(h.auth).not.toHaveBeenCalled()
    expect(h.provisionZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('requires a slug', async () => {
    const res: any = await POST(postReq({}))
    expect(res.status).toBe(400)
  })

  it('requires sign-in', async () => {
    h.auth.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'signin' })
    expect(h.provisionZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('blocks a non-paid (hobbyist) tier', async () => {
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'tier', tier: 'hobbyist' })
    expect(h.provisionZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('fails closed to the un-paid default when plan lookup itself errors', async () => {
    h.getPlanStatus.mockRejectedValue(new Error('core unreachable'))
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.reason).toBe('tier')
    expect(h.provisionZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('404s when the company does not exist', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('provisions a real number for a paid, signed-in founder and persists it', async () => {
    h.provisionZeroVoiceNumber.mockResolvedValue({ ok: true, numberId: 'num-new', e164: '+15559998888' })
    const res: any = await POST(postReq({ slug: 'acme', countryCode: 'CA', type: 'mobile' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, numberId: 'num-new', e164: '+15559998888' })
    expect(h.provisionZeroVoiceNumber).toHaveBeenCalledWith('tok', 'acme', 'CA', 'mobile')
    expect(h.setAppZeroVoice).toHaveBeenCalledWith('acme', { numberId: 'num-new', e164: '+15559998888' })
  })

  it('defaults countryCode/type when not provided', async () => {
    h.provisionZeroVoiceNumber.mockResolvedValue({ ok: true, numberId: 'num-new', e164: '+15551112222' })
    await POST(postReq({ slug: 'acme' }))
    expect(h.provisionZeroVoiceNumber).toHaveBeenCalledWith('tok', 'acme', 'US', 'local')
  })

  it('short-circuits to the existing number for an already-provisioned company — never calls the provisioning client', async () => {
    h.resolveApp.mockResolvedValue(PROVISIONED)
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, numberId: 'num-existing', e164: '+15551234567' })
    expect(h.provisionZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('surfaces a real provisioning failure honestly, never fabricates success', async () => {
    h.provisionZeroVoiceNumber.mockResolvedValue({ ok: false, reason: 'no_available_numbers' })
    const res: any = await POST(postReq({ slug: 'acme' }))
    const json = await res.json()
    expect(json).toEqual(expect.objectContaining({ ok: false, reason: 'no_available_numbers' }))
    expect(h.setAppZeroVoice).not.toHaveBeenCalled()
  })
})
