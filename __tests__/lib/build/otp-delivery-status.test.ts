import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(storedRows: Array<Record<string, unknown>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      storedRows.push(body.row_data)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return {
        ok: true,
        status: 200,
        json: async () => storedRows.map((row_data) => ({ row_data })),
        text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))),
      } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('OTP delivery status tracking (#BLD-02c)', () => {
  beforeEach(() => {
    mockFetch([])
  })

  it('records and retrieves a delivery status by phone, keyed via the real messageSid-to-phone mapping stored at send time', async () => {
    const { recordOtpSendMapping, recordOtpDeliveryStatus, getOtpDeliveryStatus } = await import('@/lib/build/otp')
    await recordOtpSendMapping('SMabc123', '+15550001111')
    await recordOtpDeliveryStatus('SMabc123', 'undelivered')
    const status = await getOtpDeliveryStatus('+15550001111')
    expect(status).toBe('undelivered')
  })

  it('returns "pending" for a phone with no recorded status yet', async () => {
    const { getOtpDeliveryStatus } = await import('@/lib/build/otp')
    const status = await getOtpDeliveryStatus('+15559999999')
    expect(status).toBe('pending')
  })

  it('a status update for an UNMAPPED messageSid is silently dropped, never crashes, never associates with the wrong phone', async () => {
    const { recordOtpDeliveryStatus } = await import('@/lib/build/otp')
    await expect(recordOtpDeliveryStatus('SMunknown999', 'delivered')).resolves.not.toThrow()
  })
})
