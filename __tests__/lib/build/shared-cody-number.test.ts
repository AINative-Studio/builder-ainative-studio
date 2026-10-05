import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFounderByPhone: vi.fn(),
  listAppsForOwner: vi.fn(),
  resolveFounderCredential: vi.fn(),
  getPlanStatus: vi.fn(),
  getPendingDisambiguation: vi.fn(),
  setPendingDisambiguation: vi.fn(),
  clearPendingDisambiguation: vi.fn(),
}))

vi.mock('@/lib/build/founder-phones', () => ({ findFounderByPhone: h.findFounderByPhone }))
vi.mock('@/lib/build/app-registry', () => ({ listAppsForOwner: h.listAppsForOwner }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))
vi.mock('@/lib/ainative/plan', () => ({
  getPlanStatus: h.getPlanStatus,
  isPaidTier: (tier: string | undefined | null) => ['pro', 'business', 'enterprise', 'cody_vcto'].includes(String(tier).toLowerCase()),
}))
vi.mock('@/lib/build/sms-disambiguation', () => ({
  getPendingDisambiguation: h.getPendingDisambiguation,
  setPendingDisambiguation: h.setPendingDisambiguation,
  clearPendingDisambiguation: h.clearPendingDisambiguation,
}))

import { handleSharedNumberSms } from '@/lib/build/shared-cody-number'

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.getPendingDisambiguation.mockResolvedValue(null)
})
afterEach(() => vi.restoreAllMocks())

describe('handleSharedNumberSms', () => {
  it('replies with a clear next step when the phone matches no founder', async () => {
    h.findFounderByPhone.mockResolvedValue(null)
    const result = await handleSharedNumberSms('+15550009999', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/phone number on your AINative account|sign up/i)
  })

  it('replies "no companies yet" when the founder has zero companies', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([])
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/don't have any companies/i)
  })

  it('replies with an upgrade prompt when the founder is not on a paid tier', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'hobbyist' })
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/paid-plan feature|upgrade/i)
  })

  it('fails closed (treats as not-paid) when tier resolution itself fails', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/paid-plan feature|upgrade/i)
  })

  it('resolves immediately to the single company when the founder has exactly one', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([{ slug: 'acme', name: 'Acme', chatId: 'c1' }])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    const result = await handleSharedNumberSms('+15550001111', 'what is the status of my app')
    expect(result.resolvedSlug).toBe('acme')
    expect(result.resolvedOwnerEmail).toBe('a@b.com')
    expect(result.replyText).toBeNull() // no reply here — caller (Task 4) runs askCody() and sends ITS answer
  })

  it('sends a numbered disambiguation list when the founder has 2+ companies and no pending state', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.setPendingDisambiguation.mockResolvedValue(true)
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/1\. Acme/)
    expect(result.replyText).toMatch(/2\. Globex/)
    expect(h.setPendingDisambiguation).toHaveBeenCalledWith('+15550001111', [
      { slug: 'acme', name: 'Acme' },
      { slug: 'globex', name: 'Globex' },
    ])
  })

  it('resolves to the chosen company when a pending disambiguation reply matches a valid number', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.getPendingDisambiguation.mockResolvedValue([{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }])
    h.clearPendingDisambiguation.mockResolvedValue(true)
    const result = await handleSharedNumberSms('+15550001111', '2')
    expect(result.resolvedSlug).toBe('globex')
    expect(h.clearPendingDisambiguation).toHaveBeenCalledWith('+15550001111')
  })

  it('re-sends the numbered list when a pending disambiguation reply is not a valid number', async () => {
    h.findFounderByPhone.mockResolvedValue({ email: 'a@b.com' })
    h.listAppsForOwner.mockResolvedValue([
      { slug: 'acme', name: 'Acme', chatId: 'c1' },
      { slug: 'globex', name: 'Globex', chatId: 'c2' },
    ])
    h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'tok' })
    h.getPlanStatus.mockResolvedValue({ tier: 'pro' })
    h.getPendingDisambiguation.mockResolvedValue([{ slug: 'acme', name: 'Acme' }, { slug: 'globex', name: 'Globex' }])
    const result = await handleSharedNumberSms('+15550001111', 'banana')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toMatch(/1\. Acme/)
    expect(h.clearPendingDisambiguation).not.toHaveBeenCalled()
  })

  it('never throws — a thrown lookup error degrades to the no-match reply', async () => {
    h.findFounderByPhone.mockRejectedValue(new Error('boom'))
    const result = await handleSharedNumberSms('+15550001111', 'hi')
    expect(result.resolvedSlug).toBeNull()
    expect(result.replyText).toBeTruthy()
  })
})
