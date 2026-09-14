import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #733 — POST /api/build/company-email.
 *
 * Thin wrapper over lib/build/company-email.ts's sendCompanyEmail, existing
 * so the standalone MCP server process (a bare Node ESM child process) can
 * reach it over HTTP the same way it reaches company-comms/route.ts, rather
 * than attempting a cross-runtime import of TypeScript source.
 */

const h = vi.hoisted(() => ({
  sendCompanyEmail: vi.fn(),
}))

vi.mock('@/lib/build/company-email', () => ({ sendCompanyEmail: h.sendCompanyEmail }))

import { POST } from '@/app/api/build/company-email/route'

function postReq(body: unknown) {
  return { json: async () => body } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sendCompanyEmail.mockResolvedValue({ ok: true, id: 'email-123' })
})

describe('POST /api/build/company-email (#733)', () => {
  it('requires companyName', async () => {
    const res: any = await POST(postReq({ to: 'to@x.com', subject: 'subj' }))
    expect(res.status).toBe(400)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('requires to', async () => {
    const res: any = await POST(postReq({ companyName: 'Acme', subject: 'subj' }))
    expect(res.status).toBe(400)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('requires subject', async () => {
    const res: any = await POST(postReq({ companyName: 'Acme', to: 'to@x.com' }))
    expect(res.status).toBe(400)
    expect(h.sendCompanyEmail).not.toHaveBeenCalled()
  })

  it('happy path: delegates to sendCompanyEmail and returns the real id', async () => {
    const res: any = await POST(postReq({ companyName: 'Acme', to: 'to@x.com', subject: 'Update', html: '<p>hi</p>', text: 'hi' }))
    const json = await res.json()
    expect(json).toEqual({ ok: true, id: 'email-123' })
    expect(h.sendCompanyEmail).toHaveBeenCalledWith('Acme', 'to@x.com', 'Update', '<p>hi</p>', 'hi')
  })

  it('falls back text to html when text is omitted', async () => {
    await POST(postReq({ companyName: 'Acme', to: 'to@x.com', subject: 'Update', html: '<p>hi</p>' }))
    expect(h.sendCompanyEmail).toHaveBeenCalledWith('Acme', 'to@x.com', 'Update', '<p>hi</p>', '<p>hi</p>')
  })

  it('surfaces an honest failure reason', async () => {
    h.sendCompanyEmail.mockResolvedValue({ ok: false, reason: 'no_resend_api_key' })
    const res: any = await POST(postReq({ companyName: 'Acme', to: 'to@x.com', subject: 'Update' }))
    const json = await res.json()
    expect(json).toEqual({ ok: false, reason: 'no_resend_api_key' })
  })
})
