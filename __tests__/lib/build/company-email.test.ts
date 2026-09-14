import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

/**
 * lib/build/company-email — general-purpose company → customer email (#733).
 * Mocks the shared lib/build/resend-client module rather than fetch directly,
 * since resend-client.test.ts already covers the real HTTP contract; this
 * suite covers company-email's own validation + from-name construction.
 */

const sendViaResendMock = vi.fn()

vi.mock('@/lib/build/resend-client', () => ({
  sendViaResend: (...args: unknown[]) => sendViaResendMock(...args),
}))

afterEach(() => {
  vi.restoreAllMocks()
  sendViaResendMock.mockReset()
})

describe('sendCompanyEmail (#733)', () => {
  it('returns { ok: false, reason: "no_company_name" } when companyName is empty', async () => {
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_company_name' })
    expect(sendViaResendMock).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_recipient" } when to is empty', async () => {
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme', '', 'subj', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_recipient' })
    expect(sendViaResendMock).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_subject" } when subject is empty', async () => {
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme', 'to@x.com', '', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'no_subject' })
    expect(sendViaResendMock).not.toHaveBeenCalled()
  })

  it('returns { ok: false, reason: "no_body" } when both html and text are empty', async () => {
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme', 'to@x.com', 'subj', '', '')
    expect(result).toEqual({ ok: false, reason: 'no_body' })
    expect(sendViaResendMock).not.toHaveBeenCalled()
  })

  it('builds the "{companyName} via AINative" from-name and delegates to the shared Resend client', async () => {
    sendViaResendMock.mockResolvedValue({ ok: true, id: 'email-abc' })
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme Robotics', 'customer@x.com', 'Your order shipped', '<p>Shipped!</p>', 'Shipped!')
    expect(result).toEqual({ ok: true, id: 'email-abc' })
    expect(sendViaResendMock).toHaveBeenCalledWith(
      'Acme Robotics via AINative <noreply@ainative.studio>',
      'customer@x.com',
      'Your order shipped',
      '<p>Shipped!</p>',
      'Shipped!',
    )
  })

  it('strips characters that would break the "Name <email>" from-header syntax', async () => {
    sendViaResendMock.mockResolvedValue({ ok: true, id: 'email-abc' })
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    await sendCompanyEmail('Acme "The Best" <Robotics>', 'customer@x.com', 'subj', '<p>hi</p>', 'hi')
    const from = sendViaResendMock.mock.calls[0][0]
    expect(from).not.toContain('"')
    expect(from).not.toContain('<Robotics>')
  })

  it('surfaces the real failure reason from the shared Resend client', async () => {
    sendViaResendMock.mockResolvedValue({ ok: false, reason: 'domain not verified', status: 403 })
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'domain not verified' })
  })

  it('falls back to "send_failed" when the shared client fails with no reason', async () => {
    sendViaResendMock.mockResolvedValue({ ok: false })
    const { sendCompanyEmail } = await import('@/lib/build/company-email')
    const result = await sendCompanyEmail('Acme', 'to@x.com', 'subj', '<p>hi</p>', 'hi')
    expect(result).toEqual({ ok: false, reason: 'send_failed' })
  })
})
