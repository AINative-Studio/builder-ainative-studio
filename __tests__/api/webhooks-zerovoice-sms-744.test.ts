import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #744 — inbound SMS → real Gitea issue. Covers: the webhook's shared-secret
 * auth (rejects missing/wrong/no-secret-configured), the resolve→createIssue
 * orchestration (happy path with the right org/title/body, no-match no-op,
 * missing-git-repo no-op, a downstream Gitea failure surfaced honestly), and
 * the optional confirmation SMS (best-effort, never blocks the already-
 * successful issue creation).
 */

const h = vi.hoisted(() => ({
  resolveAppByZeroVoiceNumber: vi.fn(),
  createIssue: vi.fn(),
  sendZeroVoiceSms: vi.fn(),
  resolveFounderCredential: vi.fn(),
}))
const { resolveAppByZeroVoiceNumber, createIssue, sendZeroVoiceSms, resolveFounderCredential } = h

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

const ORIGINAL_ENV = process.env

beforeEach(() => {
  vi.resetModules()
  process.env = { ...ORIGINAL_ENV, ZEROVOICE_SMS_WEBHOOK_SECRET: 'test-shared-secret' }
  resolveAppByZeroVoiceNumber.mockReset()
  createIssue.mockReset()
  sendZeroVoiceSms.mockReset()
  resolveFounderCredential.mockReset()
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

describe('handleInboundSms orchestration (#744)', () => {
  it('happy path: resolves the company, creates the issue with the right org/title/body, sends confirmation', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      gitOrg: 'ws-acme-workspace',
      gitRepoId: '123',
      zerovoiceE164: '+15559998888',
      createdAt: '2026-08-01T00:00:00Z',
    })
    createIssue.mockResolvedValue({ ok: true, issueNumber: 42, url: 'https://git.example/ws-acme-workspace/acme/issues/42' })
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    sendZeroVoiceSms.mockResolvedValue({ ok: true, sid: 'SMabc' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())

    expect(result.ok).toBe(true)
    expect(result.issueNumber).toBe(42)
    expect(createIssue).toHaveBeenCalledWith(
      'ws-acme-workspace',
      'acme',
      expect.stringContaining('Add a dark mode toggle please'),
      expect.stringContaining('Add a dark mode toggle please'),
    )
    expect(sendZeroVoiceSms).toHaveBeenCalledWith('jwt-token', '+15559998888', '+15550001111', expect.stringContaining('#42'))
  })

  it('no-op with an honest reason when no company matches the inbound number — never a fallback company', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue(null)
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_matching_company')
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('no-op with an honest reason when the matched company has no provisioned Gitea repo', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      zerovoiceE164: '+15559998888',
      createdAt: '2026-08-01T00:00:00Z',
      // no gitOrg/gitRepoId
    })
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_git_repo')
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('surfaces a downstream Gitea failure honestly rather than silently dropping it', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      gitOrg: 'ws-acme-workspace',
      gitRepoId: '123',
      createdAt: '2026-08-01T00:00:00Z',
    })
    createIssue.mockResolvedValue({ ok: false, reason: 'gitea createIssue failed: 500' })
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('failed')
  })

  it('a failed confirmation SMS does not undo or mask the successful issue creation', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      gitOrg: 'ws-acme-workspace',
      gitRepoId: '123',
      zerovoiceE164: '+15559998888',
      createdAt: '2026-08-01T00:00:00Z',
    })
    createIssue.mockResolvedValue({ ok: true, issueNumber: 7, url: 'https://git.example/x/y/issues/7' })
    resolveFounderCredential.mockResolvedValue({ ok: true, accessToken: 'jwt-token' })
    sendZeroVoiceSms.mockRejectedValue(new Error('network blip'))

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(true)
    expect(result.issueNumber).toBe(7)
  })

  it('skips the confirmation SMS gracefully when no founder credential is available', async () => {
    resolveAppByZeroVoiceNumber.mockResolvedValue({
      slug: 'acme',
      chatId: 'chat-1',
      gitOrg: 'ws-acme-workspace',
      gitRepoId: '123',
      zerovoiceE164: '+15559998888',
      createdAt: '2026-08-01T00:00:00Z',
    })
    createIssue.mockResolvedValue({ ok: true, issueNumber: 9, url: 'https://git.example/x/y/issues/9' })
    resolveFounderCredential.mockResolvedValue({ ok: false, reason: 'not_provisioned' })

    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms(smsPayload())
    expect(result.ok).toBe(true)
    expect(sendZeroVoiceSms).not.toHaveBeenCalled()
  })

  it('rejects a payload missing the To field before ever resolving a company', async () => {
    const { handleInboundSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const result = await handleInboundSms({ From: '+1555', Body: 'hi' })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_to')
    expect(resolveAppByZeroVoiceNumber).not.toHaveBeenCalled()
  })
})

describe('titleFromSmsBody / issueBodyFromSms (pure, #744)', () => {
  it('truncates a long SMS body sensibly for the title, but keeps the full text in the body', async () => {
    const { titleFromSmsBody, issueBodyFromSms } = await import('@/app/api/webhooks/zerovoice-sms/route')
    const longBody = 'x'.repeat(200)
    const title = titleFromSmsBody(longBody)
    expect(title.length).toBeLessThanOrEqual(80)
    const body = issueBodyFromSms(longBody, '+1555', '2026-09-14T00:00:00Z')
    expect(body).toContain(longBody)
  })

  it('falls back to a generic title for an empty body', async () => {
    const { titleFromSmsBody } = await import('@/app/api/webhooks/zerovoice-sms/route')
    expect(titleFromSmsBody('')).toBe('Feature idea via SMS')
  })
})
