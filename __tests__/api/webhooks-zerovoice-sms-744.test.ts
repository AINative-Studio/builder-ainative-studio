import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #744 + real-conversation follow-up (2026-09-16) — inbound SMS is now a
 * real two-way conversation with Cody via the same askCody() pipeline the
 * dashboard chat modal uses, not a one-shot "text becomes an issue" action.
 * Covers: the webhook's shared-secret auth (rejects missing/wrong/no-secret-
 * configured), scope/tier resolution from the company's stored ownerEmail +
 * founder credential (no live session available for a text), the askCody
 * happy path (real reply texted back, no forced issue filing), and the
 * honest fallback when askCody itself is unavailable (still logs a Gitea
 * issue so the founder's message isn't silently dropped).
 */

const h = vi.hoisted(() => ({
  resolveAppByZeroVoiceNumber: vi.fn(),
  createIssue: vi.fn(),
  sendZeroVoiceSms: vi.fn(),
  resolveFounderCredential: vi.fn(),
  detectEditIntent: vi.fn(),
  askCody: vi.fn(),
  getPlanStatus: vi.fn(),
}))
const {
  resolveAppByZeroVoiceNumber,
  createIssue,
  sendZeroVoiceSms,
  resolveFounderCredential,
  detectEditIntent,
  askCody,
  getPlanStatus,
} = h

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppByZeroVoiceNumber: h.resolveAppByZeroVoiceNumber,
}))
vi.mock('@/lib/git/gitea-client', () => ({
  createIssue: h.createIssue,
}))
vi.mock('@/lib/build/zerovoice', () => ({
  sendZeroVoiceSms: h.sendZeroVoiceSms,
}))
vi.mock('@/lib/build/primitive-credentials', () => ({
  resolveFounderCredential: h.resolveFounderCredential,
}))
vi.mock('@/lib/build/edit-intent', () => ({
  detectEditIntent: h.detectEditIntent,
}))
vi.mock('@/app/api/build/ask/route', () => ({
  askCody: h.askCody,
}))
vi.mock('@/lib/ainative/plan', () => ({
  getPlanStatus: h.getPlanStatus,
}))

const ORIGINAL_ENV = process.env

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV, ZEROVOICE_SMS_WEBHOOK_SECRET: 'test-shared-secret' }
  resolveAppByZeroVoiceNumber.mockReset()
  createIssue.mockReset()
  sendZeroVoiceSms.mockReset()
  resolveFounderCredential.mockReset()
  detectEditIntent.mockReset().mockReturnValue(false)
  askCody.mockReset()
  getPlanStatus.mockReset()
})
afterEach(() => {
  process.env = ORIGINAL_ENV
  vi.restoreAllMocks()
})

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as any
}

const smsPayload = (overrides: Partial<{ From: string; To: string; Body: string; MessageSid: string }> = {}) => ({
  From: '+15550001111',
  To: '+15559998888',
  Body: 'Add a dark mode toggle please',
  MessageSid: 'SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  ...overrides,
})

const acmeApp = (overrides: Record<string, unknown> = {}) => ({
  slug: 'acme',
  name: 'Acme',
  chatId: 'chat-1',
  idea: 'A CRM for plumbers',
  track: 'company',
  gitOrg: 'ws-acme-workspace',
  gitRepoId: '123',
  zerovoiceE164: '+15559998888',
  ownerEmail: 'founder@acme.test',
  createdAt: '2026-08-01T00:00:00Z',
  ...overrides,
})

describe('POST /api/webhooks/zerovoice-sms — auth (#744)', () => {
  it('rejects a request with no secret header at all', async () => {
    const { POST } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const res = await POST(req(smsPayload()))
    expect(res.status).toBe(401)
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong secret', async () => {
    const { POST } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const res = await POST(req(smsPayload(), { 'x-builder-webhook-secret': 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('fails closed (rejects everyone) when ZEROVOICE_SMS_WEBHOOK_SECRET is unset — never dev-mode-trusts', async () => {
    process.env.ZEROVOICE_SMS_WEBHOOK_SECRET = ''
    const { POST } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const res = await POST(req(smsPayload(), { 'x-builder-webhook-secret': 'anything' }))
    expect(res.status).toBe(401)
  })

  it('accepts a request with the correct secret and proceeds to processing', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const { POST } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const res = await POST(req(smsPayload(), { 'x-builder-webhook-secret': 'test-shared-secret' }))
    expect(resolveAppByZeroVoiceNumber).toHaveBeenCalledWith('+15559998888')
    expect(res.status).toBe(422) // no company matched → honest failure, not 401
  })
})

describe('handleInboundSms — real conversation via askCody (#744 follow-up)', () => {
  it('happy path: resolves the company, derives scope from ownerEmail, calls askCody, texts back the real reply', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'Sure — dark mode is on my list, I can start now.', provider: 'anthropic', model: 'claude' })
    sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMabc' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())

    expect(result.ok).toBe(true)
    expect(askCody).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Add a dark mode toggle please',
        idea: 'A CRM for plumbers',
        companyName: 'Acme',
        track: 'company',
        companyId: 'acme',
        scopeKey: 'founder@acme.test::acme',
        tier: 'pro',
      }),
    )
    expect(sendZeroVoiceSms).toHaveBeenCalledWith(
      'jwt-token',
      '+15559998888',
      '+15550001111',
      expect.stringContaining('Sure — dark mode'),
    )
    // A genuine reply was sent — this is no longer a blanket "always file an issue" action.
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('falls back to the founder\'s stored plan when no live credential can be resolved', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })
    askCody.mockResolvedValue({ answer: 'Got it.', provider: 'anthropic', model: 'claude' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    await handleInboundSms(smsPayload())

    expect(getPlanStatus).not.toHaveBeenCalled()
    expect(askCody).toHaveBeenCalledWith(expect.objectContaining({ tier: 'hobbyist' }))
    // No credential means no reply can be sent back — logged, not thrown.
    expect(sendZeroVoiceSms).not.toHaveBeenCalled()
  })

  it('no-op with an honest reason when no company matches the inbound number — never a fallback company', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_matching_company')
    expect(askCody).not.toHaveBeenCalled()
  })

  it('rejects a payload missing the To field before ever resolving a company', async () => {
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms({ From: '+1555', Body: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_to')
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('treats an empty body as a no-op — nothing for Cody to reply to', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload({ Body: '' }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('empty_body')
    expect(askCody).not.toHaveBeenCalled()
  })

  it('reports a real change request (detectEditIntent match) via editTriggered, same signal the dashboard uses', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    detectEditIntent.mockReturnValue(true)
    askCody.mockResolvedValue({ answer: 'On it — building dark mode now.', provider: 'anthropic', model: 'claude' })
    sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMabc' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())

    expect(result.editTriggered).toBe(true)
    // The actual dispatch is askCody's own internal concern (same as the dashboard) —
    // this webhook itself never files a separate, blanket issue.
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('falls back to filing a Gitea issue so the founder\'s message is never silently dropped when askCody is unavailable', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ error: 'unavailable', status: 503 })
    createIssue.mockResolvedValue({ ok: true, issueNumber: 42, url: 'https://git.example/ws-acme-workspace/acme/issues/42' })
    sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMabc' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('fallback_logged')
    expect(result.issueNumber).toBe(42)
    expect(createIssue).toHaveBeenCalledWith(
      'ws-acme-workspace',
      'acme',
      expect.stringContaining('Add a dark mode toggle please'),
      expect.stringContaining('Add a dark mode toggle please'),
    )
    // The founder still gets *some* honest reply, not silence.
    expect(sendZeroVoiceSms).toHaveBeenCalledWith('jwt-token', '+15559998888', '+15550001111', expect.any(String))
  })

  it('does not send a reply when the company has no ZeroVoice number to send from', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp({ zerovoiceE164: undefined }))
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'Got it.', provider: 'anthropic', model: 'claude' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    await handleInboundSms(smsPayload())

    expect(sendZeroVoiceSms).not.toHaveBeenCalled()
  })

  it('a thrown askCody error does not crash the webhook — falls back honestly', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockRejectedValue(new Error('network blip'))
    createIssue.mockResolvedValue({ ok: true, issueNumber: 9, url: 'https://git.example/x/y/issues/9' })
    sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMabc' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('fallback_logged')
  })
})
