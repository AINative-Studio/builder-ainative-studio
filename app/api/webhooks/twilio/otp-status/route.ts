import { NextRequest } from 'next/server'
import { recordOtpDeliveryStatus } from '@/lib/build/otp'

export const runtime = 'nodejs'

const TERMINAL_STATUSES = new Set(['delivered', 'undelivered', 'failed'])

/**
 * Twilio's real StatusCallback for OTP sends (#BLD-02c) — form-encoded POST,
 * MessageSid + MessageStatus are the fields this handler cares about. Only
 * terminal statuses are recorded (queued/sending/sent are mid-flight, not
 * actionable). Always returns 200 — a non-2xx makes Twilio retry the
 * callback, and a malformed/unexpected body here is never Twilio's fault to
 * retry into.
 */
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    const params = new URLSearchParams(raw)
    const messageSid = params.get('MessageSid')
    const status = params.get('MessageStatus')
    if (messageSid && status && TERMINAL_STATUSES.has(status)) {
      await recordOtpDeliveryStatus(messageSid, status as 'delivered' | 'undelivered' | 'failed')
    }
  } catch {
    // never fail this webhook — see doc comment above
  }
  return new Response(null, { status: 200 })
}
