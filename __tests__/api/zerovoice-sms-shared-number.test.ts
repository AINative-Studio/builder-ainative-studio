/**
 * #936 — the shared-number branch inside handleInboundSms. Core and all
 * shared-number/credential/tier logic are mocked; this test only verifies
 * the ROUTING decision (shared-number path tried only on a dedicated-number
 * miss) and that a resolved company flows into the same askCody()+reply
 * pipeline the dedicated-number path already uses.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Module-load-time env capture (same ruling as Tasks 1/2): WEBHOOK_SECRET
// and SHARED_NUMBER are read as consts when route.ts loads. A static
// `import { POST } from ...` is ALWAYS hoisted above plain statements per
// the ES module spec — a later `process.env.X = ...` line (even textually
// above the import) runs after the module has already captured empty
// values. vi.hoisted() is the only block that genuinely runs first.
vi.hoisted(() => {
  process.env.ZEROVOICE_SMS_WEBHOOK_SECRET = 'test-secret'
  process.env.ZEROVOICE_SHARED_NUMBER = '+19377642838'
})

const h = vi.hoisted(() => ({
  resolveAppByZeroVoiceNumber: vi.fn(),
  resolveApp: vi.fn(),
  handleSharedNumberSms: vi.fn(),
  sendSharedSms: vi.fn(),
  askCody: vi.fn(),
  resolveFounderCredential: vi.fn(),
  sendZeroVoiceSms: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppByZeroVoiceNumber: h.resolveAppByZeroVoiceNumber,
  resolveApp: h.resolveApp,
}))
vi.mock('@/lib/build/shared-cody-number', () => ({ handleSharedNumberSms: h.handleSharedNumberSms }))
vi.mock('@/lib/build/otp', () => ({ sendSharedSms: h.sendSharedSms }))
vi.mock('@/app/api/build/ask/route', () => ({ askCody: h.askCody }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))
vi.mock('@/lib/build/zerovoice', () => ({ sendZeroVoiceSms: h.sendZeroVoiceSms }))
vi.mock('@/lib/git/gitea-client', () => ({ createIssue: vi.fn() }))

import { POST } from '@/app/api/webhooks/zerovoice-sms/route'

function req(payload: Record<string, unknown>) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'x-builder-webhook-secret' ? 'test-secret' : null) },
    text: async () => JSON.stringify(payload),
  } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  // Defaults for the EXISTING dedicated-number path (handleInboundSms's own,
  // untouched logic) — a test exercising that path (e.g. a real
  // resolveAppByZeroVoiceNumber match) would otherwise crash reading an
  // unmocked undefined off these shared mocks.
  h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
  h.askCody.mockResolvedValue({ answer: 'default test answer' })
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/webhooks/zerovoice-sms — shared-number routing (#936)', () => {
  it('tries the shared-number path ONLY when the dedicated-number lookup misses', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue({ slug: 'acme', ownerEmail: 'a@b.com', gitOrg: null }) // a real match
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'hi' }))
    expect(h.handleSharedNumberSms).not.toHaveBeenCalled()
  })

  it('does not try the shared-number path for a To that is neither a dedicated number NOR the shared number', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const res = await POST(req({ To: '+15559998888', From: '+15550001111', Body: 'hi' }))
    expect(h.handleSharedNumberSms).not.toHaveBeenCalled()
    const data = await res.json()
    expect(data.reason).toBe('no_matching_company')
  })

  it('sends the replyText directly via sendSharedSms when handleSharedNumberSms returns a non-null reply (no company resolved)', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    h.handleSharedNumberSms.mockResolvedValue({ replyText: 'Upgrade required.', resolvedSlug: null, resolvedOwnerEmail: null })
    h.sendSharedSms.mockResolvedValue({ ok: true })
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'hi' }))
    expect(h.sendSharedSms).toHaveBeenCalledWith('+15550001111', 'Upgrade required.')
    expect(h.askCody).not.toHaveBeenCalled()
  })

  it('runs askCody() and sends ITS reply via sendSharedSms when a company IS resolved', async () => {
    h.resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    h.handleSharedNumberSms.mockResolvedValue({ replyText: null, resolvedSlug: 'acme', resolvedOwnerEmail: 'a@b.com' })
    h.resolveApp.mockResolvedValue({ slug: 'acme', name: 'Acme', chatId: 'c1', idea: 'an idea', track: 'company', gitOrg: null })
    h.askCody.mockResolvedValue({ answer: 'Your app is live.' })
    h.sendSharedSms.mockResolvedValue({ ok: true })
    const res = await POST(req({ To: '+19377642838', From: '+15550001111', Body: 'what is my status' }))
    expect(h.askCody).toHaveBeenCalled()
    expect(h.sendSharedSms).toHaveBeenCalledWith('+15550001111', 'Your app is live.')
  })
})
