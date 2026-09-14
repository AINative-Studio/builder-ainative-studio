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

/**
 * Welcome email (#758) — fired once from Cody at a founder's genuinely first
 * company registration. Content must include the real preview link and must
 * NEVER claim a permanent backend/auth/domain is live, since provisioning
 * may not have run yet — the exact overclaim class #748 fixed elsewhere.
 */
describe('renderWelcomeEmail (#758)', () => {
  it('includes the real preview link built from builder.ainative.studio/build/{slug}', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { subject, html, text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    const previewUrl = 'https://builder.ainative.studio/build/acme-robotics'
    expect(text).toContain(previewUrl)
    expect(html).toContain(previewUrl)
    expect(subject).toContain('Acme Robotics')
  })

  it('names the company in the subject and body', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { subject, text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    expect(subject).toMatch(/Acme Robotics/)
    expect(text).toMatch(/Acme Robotics/)
  })

  it('claims the preview is real and working (honest, already-true capability)', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    expect(text).toMatch(/real, interactive app/i)
    expect(text).toMatch(/data layer/i)
  })

  it('never claims the permanent backend/auth/domain is already live', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { text, html } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    // Must not assert these as already-done facts.
    expect(text).not.toMatch(/your database is fully connected/i)
    expect(text).not.toMatch(/your (real )?authentication is (live|connected|set up)/i)
    expect(text).not.toMatch(/your custom domain is live/i)
    // Must frame provisioning/auth/domain as upcoming, not already complete.
    expect(text + html).toMatch(/still ahead|kicks off automatically|provision/i)
  })

  it('mentions the nightly loop and the comms-digest cadence (#743)', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    expect(text).toMatch(/nightly loop/i)
    expect(text).toMatch(/daily standup/i)
  })

  it('is signed from Cody in first person', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    expect(text).toMatch(/Cody here/i)
    expect(text.trim().endsWith('— Cody')).toBe(true)
  })

  it('escapes HTML-unsafe characters in the company name', async () => {
    const { renderWelcomeEmail } = await import('@/lib/build/company-email')
    const { html } = renderWelcomeEmail('Acme <script>alert(1)</script>', 'acme')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('sendWelcomeEmail (#758)', () => {
  it('delegates to sendCompanyEmail with the rendered subject/html/text and the "{companyName} via AINative" from-name', async () => {
    sendViaResendMock.mockResolvedValue({ ok: true, id: 'email-welcome-1' })
    const { sendWelcomeEmail, renderWelcomeEmail } = await import('@/lib/build/company-email')
    const result = await sendWelcomeEmail('Acme Robotics', 'founder@acme.com', 'acme-robotics')
    expect(result).toEqual({ ok: true })
    const { subject, html, text } = renderWelcomeEmail('Acme Robotics', 'acme-robotics')
    expect(sendViaResendMock).toHaveBeenCalledWith(
      'Acme Robotics via AINative <noreply@ainative.studio>',
      'founder@acme.com',
      subject,
      html,
      text,
    )
  })

  it('surfaces the real failure reason without throwing', async () => {
    sendViaResendMock.mockResolvedValue({ ok: false, reason: 'domain not verified' })
    const { sendWelcomeEmail } = await import('@/lib/build/company-email')
    const result = await sendWelcomeEmail('Acme Robotics', 'founder@acme.com', 'acme-robotics')
    expect(result).toEqual({ ok: false, reason: 'domain not verified' })
  })
})
