import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #733 — POST /api/build/company-comms.
 *
 * The entry point Cody's own runtime (or the nightly loop) calls to actually
 * text/call a company's customer, once that company has a real provisioned
 * ZeroVoice number and a captured founder credential. Never a new proxy path
 * — resolves both pieces itself via the existing registry + credential store,
 * then calls the real ZeroVoice send functions.
 *
 * Properties under test:
 *  - requires slug, a valid action, a recipient in E.164, and body for sms;
 *  - a company with no provisioned ZeroVoice number fails honestly, never
 *    calling the credential resolver or either send function;
 *  - a company with no captured founder credential fails honestly with the
 *    credential resolver's own reason;
 *  - happy path SMS sends via the company's OWN zerovoiceE164 as `from` and
 *    returns the real sid;
 *  - happy path call does the same and returns the real callId;
 *  - a real ZeroVoice API failure on either path is surfaced honestly, never
 *    fabricating a sid/callId.
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  resolveFounderCredential: vi.fn(),
  sendZeroVoiceSms: vi.fn(),
  makeZeroVoiceCall: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/primitive-credentials', () => ({ resolveFounderCredential: h.resolveFounderCredential }))
vi.mock('@/lib/build/zerovoice', () => ({
  sendZeroVoiceSms: h.sendZeroVoiceSms,
  makeZeroVoiceCall: h.makeZeroVoiceCall,
}))

import { POST } from '@/app/api/build/company-comms/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

const PROVISIONED_APP = {
  slug: 'acme',
  chatId: 'c1',
  createdAt: '2026-08-01T00:00:00Z',
  zerovoiceProvisioned: true,
  zerovoiceNumberId: 'num-1',
  zerovoiceE164: '+15551234567',
}
const UNPROVISIONED_APP = { slug: 'acme', chatId: 'c1', createdAt: '2026-08-01T00:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveApp.mockResolvedValue(PROVISIONED_APP)
  h.resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'founder-jwt' })
  h.sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMxxxx' })
  h.makeZeroVoiceCall.mockResolvedValue({ ok: true, callId: 'CAxxxx' })
})

describe('POST /api/build/company-comms (#733)', () => {
  it('requires a slug', async () => {
    const res: any = await POST(postReq({ action: 'sms', to: '+15550002222', body: 'hi' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
  })

  it('rejects an invalid action', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'email', to: '+15550002222' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'invalid_action' })
  })

  it('requires a recipient', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', body: 'hi' }))
    expect(res.status).toBe(400)
  })

  it('rejects a non-E.164 recipient', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '555-000-2222', body: 'hi' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('to_must_be_e164')
  })

  it('requires body for sms', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '+15550002222' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toContain('body required')
  })

  it('returns 404 for an unknown company', async () => {
    h.resolveApp.mockResolvedValue(null)
    const res: any = await POST(postReq({ slug: 'ghost', action: 'sms', to: '+15550002222', body: 'hi' }))
    expect(res.status).toBe(404)
    expect(h.resolveFounderCredential).not.toHaveBeenCalled()
  })

  it('fails honestly when the company has no provisioned ZeroVoice number', async () => {
    h.resolveApp.mockResolvedValue(UNPROVISIONED_APP)
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'no_zerovoice_number_provisioned' })
    expect(h.resolveFounderCredential).not.toHaveBeenCalled()
    expect(h.sendZeroVoiceSms).not.toHaveBeenCalled()
  })

  it('fails honestly when there is no captured founder credential', async () => {
    h.resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'not_provisioned' })
    expect(h.sendZeroVoiceSms).not.toHaveBeenCalled()
  })

  it('happy path: sends SMS from the company\'s own number and returns the real sid', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'Your order shipped!' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, sid: 'SMxxxx' })
    expect(h.sendZeroVoiceSms).toHaveBeenCalledWith('founder-jwt', '+15551234567', '+15550002222', 'Your order shipped!')
  })

  it('happy path: places a call from the company\'s own number and returns the real callId', async () => {
    const res: any = await POST(postReq({ slug: 'acme', action: 'call', to: '+15550002222' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, callId: 'CAxxxx' })
    expect(h.makeZeroVoiceCall).toHaveBeenCalledWith('founder-jwt', '+15551234567', '+15550002222', { record: false })
  })

  it('passes record:true through on a call when requested', async () => {
    await POST(postReq({ slug: 'acme', action: 'call', to: '+15550002222', record: true }))
    expect(h.makeZeroVoiceCall).toHaveBeenCalledWith('founder-jwt', '+15551234567', '+15550002222', { record: true })
  })

  it('surfaces a real SMS send failure honestly', async () => {
    h.sendZeroVoiceSms.mockResolvedValue({ ok: false, reason: 'Invalid from_number', status: 400 })
    const res: any = await POST(postReq({ slug: 'acme', action: 'sms', to: '+15550002222', body: 'hi' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'Invalid from_number', status: 400 })
  })

  it('surfaces a real call failure honestly', async () => {
    h.makeZeroVoiceCall.mockResolvedValue({ ok: false, reason: 'Insufficient account balance', status: 402 })
    const res: any = await POST(postReq({ slug: 'acme', action: 'call', to: '+15550002222' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'Insufficient account balance', status: 402 })
  })
})
