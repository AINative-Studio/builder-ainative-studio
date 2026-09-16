import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * POST /api/webhooks/zerovoice-voice (2026-09-16, call counterpart to
 * #744's real SMS conversation) — a founder calls Cody and has a real,
 * turn-by-turn voice conversation via the shared askCody() pipeline.
 *
 * Covers: shared-secret auth (mirrors the SMS webhook exactly), the greeting
 * on turn 1 with no speech yet, real turn N conversation via askCody, the
 * spoken-length cap, a natural "goodbye" ending the call, the MAX_TURNS
 * ceiling, and honest spoken fallbacks when no company matches or askCody
 * itself is unavailable — never dead air, never a crash mid-call.
 */

const h = vi.hoisted(() => ({
  resolveAppByZeroVoiceNumber: vi.fn(),
  resolveFounderCredential: vi.fn(),
  askCody: vi.fn(),
  getPlanStatus: vi.fn(),
}))
const { resolveAppByZeroVoiceNumber, resolveFounderCredential, askCody, getPlanStatus } = h

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppByZeroVoiceNumber: h.resolveAppByZeroVoiceNumber,
}))
vi.mock('@/lib/build/primitive-credentials', () => ({
  resolveFounderCredential: h.resolveFounderCredential,
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
  resolveFounderCredential.mockReset()
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

const callPayload = (overrides: Partial<{ From: string; To: string; SpeechResult: string | null; Turn: number; CallSid: string; Direction: string; CallPurpose: string | null }> = {}) => ({
  From: '+15550001111',
  To: '+15559998888',
  SpeechResult: null,
  Turn: 1,
  CallSid: 'CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  ...overrides,
})

const acmeApp = (overrides: Record<string, unknown> = {}) => ({
  slug: 'acme',
  name: 'Acme',
  chatId: 'chat-1',
  idea: 'A CRM for plumbers',
  track: 'company',
  zerovoiceE164: '+15559998888',
  ownerEmail: 'founder@acme.test',
  createdAt: '2026-08-01T00:00:00Z',
  ...overrides,
})

describe('POST /api/webhooks/zerovoice-voice — auth', () => {
  it('rejects a request with no secret header at all', async () => {
    const { POST } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const res = await POST(req(callPayload()))
    expect(res.status).toBe(401)
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong secret', async () => {
    const { POST } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const res = await POST(req(callPayload(), { 'x-builder-webhook-secret': 'wrong-secret' }))
    expect(res.status).toBe(401)
  })

  it('fails closed when ZEROVOICE_SMS_WEBHOOK_SECRET is unset', async () => {
    process.env.ZEROVOICE_SMS_WEBHOOK_SECRET = ''
    const { POST } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const res = await POST(req(callPayload(), { 'x-builder-webhook-secret': 'anything' }))
    expect(res.status).toBe(401)
  })

  it('accepts a request with the correct secret and proceeds', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { POST } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const res = await POST(req(callPayload(), { 'x-builder-webhook-secret': 'test-shared-secret' }))
    expect(res.status).toBe(200)
    expect(resolveAppByZeroVoiceNumber).toHaveBeenCalledWith('+15559998888')
  })
})

describe('handleInboundCallTurn — real conversation via askCody', () => {
  it('greets by company name on turn 1 with no speech yet, without calling askCody', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 1, SpeechResult: null }))

    expect(result.hangup).toBe(false)
    expect(result.say).toContain('Acme')
    expect(askCody).not.toHaveBeenCalled()
  })

  it('resolves the company via From (not To) on an outbound call Cody placed itself — real bug: To is the callee, never the company number', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    // On an outbound call, To=the callee, From=the company's own number.
    await handleInboundCallTurn(callPayload({
      Turn: 1, SpeechResult: null, Direction: 'outbound',
      From: '+15559998888', To: '+15550001111',
    }))

    expect(resolveAppByZeroVoiceNumber).toHaveBeenCalledWith('+15559998888')
  })

  it('opens an outbound call with the real purpose, not the generic inbound greeting', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({
      Turn: 1, SpeechResult: null, Direction: 'outbound',
      From: '+15559998888', To: '+15550001111',
      CallPurpose: 'confirm your appointment tomorrow at 3pm',
    }))

    expect(result.hangup).toBe(false)
    expect(result.say).toContain('Acme')
    expect(result.say).toContain('confirm your appointment tomorrow at 3pm')
    expect(askCody).not.toHaveBeenCalled()
  })

  it('opens an outbound call with a generic-but-honest line when no purpose was set', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({
      Turn: 1, SpeechResult: null, Direction: 'outbound',
      From: '+15559998888', To: '+15550001111', CallPurpose: null,
    }))

    expect(result.say).toContain('Acme')
    expect(result.say).not.toContain('What can I help you with')
  })

  it('calls askCody with the transcribed speech on a real turn and speaks back the real answer', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'Sure, I can help with that.', provider: 'anthropic', model: 'claude' })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: 'What is the status of my build?' }))

    expect(askCody).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'What is the status of my build?',
        companyId: 'acme',
        scopeKey: 'founder@acme.test::acme',
        tier: 'pro',
      }),
    )
    expect(result.say).toBe('Sure, I can help with that.')
    expect(result.hangup).toBe(false)
  })

  it('caps conversation history sent per turn — real bug found live: unbounded shared history made turns slower and slower until a real call timed out', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'Got it.', provider: 'anthropic', model: 'claude' })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: 'hi' }))

    const call = askCody.mock.calls[0][0]
    expect(call.historyLimit).toBeGreaterThan(0)
    // A live caller needs a fast reply every turn — this must stay small,
    // nowhere near the shared dashboard/SMS default of 100 full turns.
    expect(call.historyLimit).toBeLessThanOrEqual(10)
  })

  it('caps the spoken reply length so a call never sits through an overlong monologue', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'x'.repeat(2000), provider: 'anthropic', model: 'claude' })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: 'tell me everything' }))

    expect(result.say.length).toBeLessThanOrEqual(600)
  })

  it('ends the call naturally when the caller says goodbye', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: "Sounds good, talk soon.", provider: 'anthropic', model: 'claude' })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 3, SpeechResult: 'Okay, goodbye' }))

    expect(result.hangup).toBe(true)
  })

  it('wraps up after MAX_TURNS to bound real per-minute call cost', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 12, SpeechResult: 'one more thing' }))

    expect(result.hangup).toBe(true)
    expect(askCody).not.toHaveBeenCalled()
  })

  it('never leaves dead air when no company matches the inbound number', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload())

    expect(result.say.length).toBeGreaterThan(0)
    expect(result.hangup).toBe(true)
    expect(askCody).not.toHaveBeenCalled()
  })

  it('speaks an honest fallback and ends the call when askCody itself is unavailable', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ error: 'unavailable', status: 503 })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: 'hello?' }))

    expect(result.hangup).toBe(true)
    expect(result.say.length).toBeGreaterThan(0)
  })

  it('re-prompts gently when the caller went quiet (no transcribed speech)', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: '' }))

    expect(result.hangup).toBe(false)
    expect(askCody).not.toHaveBeenCalled()
  })

  it('rejects a payload missing the To field before ever resolving a company', async () => {
    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    const result = await handleInboundCallTurn({ From: '+1555' })
    expect(result.hangup).toBe(true)
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })

  it('falls back through other captured primitive credentials when zerovoice itself has no row', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(acmeApp())
    resolveFounderCredential.mockImplementation(async (_slug: string, primitive: string) => {
      if (primitive === 'zerocrm') return { ok: true, accessToken: 'zerocrm-jwt' }
      return { ok: false, reason: 'not_provisioned' }
    })
    getPlanStatus.mockResolvedValue({ tier: 'pro' })
    askCody.mockResolvedValue({ answer: 'Got it.', provider: 'anthropic', model: 'claude' })

    const { handleInboundCallTurn } = await import('@/app/api/webhooks/zerovoice-voice/route')
    await handleInboundCallTurn(callPayload({ Turn: 2, SpeechResult: 'hi' }))

    expect(getPlanStatus).toHaveBeenCalledWith('zerocrm-jwt')
  })
})
