/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ recordOtpDeliveryStatus: vi.fn() }))
vi.mock('@/lib/build/otp', () => ({ recordOtpDeliveryStatus: h.recordOtpDeliveryStatus }))

import { POST } from '@/app/api/webhooks/twilio/otp-status/route'

function formReq(fields: Record<string, string>) {
  const body = new URLSearchParams(fields)
  return {
    text: async () => body.toString(),
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/x-www-form-urlencoded' : null) },
  } as any
}

describe('POST /api/webhooks/twilio/otp-status (#BLD-02c)', () => {
  beforeEach(() => { h.recordOtpDeliveryStatus.mockReset().mockResolvedValue(undefined) })

  it('records an undelivered status against the real MessageSid', async () => {
    const res = await POST(formReq({ MessageSid: 'SMabc123', MessageStatus: 'undelivered', ErrorCode: '30034' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).toHaveBeenCalledWith('SMabc123', 'undelivered')
  })

  it('records a delivered status the same way', async () => {
    const res = await POST(formReq({ MessageSid: 'SMdef456', MessageStatus: 'delivered' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).toHaveBeenCalledWith('SMdef456', 'delivered')
  })

  it('ignores an intermediate status (queued, sent) — only terminal statuses are recorded', async () => {
    const res = await POST(formReq({ MessageSid: 'SMghi789', MessageStatus: 'sent' }))
    expect(res.status).toBe(200)
    expect(h.recordOtpDeliveryStatus).not.toHaveBeenCalled()
  })

  it('returns 200 even on a malformed body, never throws (Twilio retries on non-2xx)', async () => {
    const res = await POST({ text: async () => 'not-a-valid-body', headers: { get: () => null } } as any)
    expect(res.status).toBe(200)
  })
})
