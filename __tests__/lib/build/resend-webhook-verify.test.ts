import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyResendWebhook } from '@/lib/build/resend-webhook-verify'

/**
 * #840 — Resend/Svix webhook signature verification. Reimplements Svix's own
 * publicly-documented manual-verification algorithm (docs.svix.com/receiving/
 * verifying-payloads/how-manual) directly against Node's crypto rather than
 * the `svix` npm package. Contracts under test:
 *  - a genuinely valid signature (correct secret, fresh timestamp, matching
 *    HMAC over `${id}.${timestamp}.${rawBody}`) verifies true;
 *  - a wrong secret, a tampered body, or a forged signature all verify false;
 *  - a missing header (any of the three) verifies false;
 *  - a stale timestamp (outside the 5-minute tolerance) verifies false, even
 *    with an otherwise-correct signature — replay protection;
 *  - a multi-entry `svix-signature` header (space-delimited `v1,<sig>`
 *    entries, Svix's key-rotation format) matches as long as ONE entry is
 *    valid;
 *  - an unconfigured secret fails closed (never verifies true).
 */

const SECRET_RAW = Buffer.from('this-is-a-test-signing-key-000000000')
const SECRET = `whsec_${SECRET_RAW.toString('base64')}`

function sign(id: string, timestamp: string, body: string, secretRaw: Buffer = SECRET_RAW): string {
  const signedContent = `${id}.${timestamp}.${body}`
  return createHmac('sha256', secretRaw).update(signedContent).digest('base64')
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000))
}

describe('verifyResendWebhook (#840)', () => {
  it('verifies a genuinely valid signature', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, timestamp, body)

    const ok = verifyResendWebhook(body, { id, timestamp, signature: `v1,${sig}` }, SECRET)
    expect(ok).toBe(true)
  })

  it('rejects a wrong secret', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, timestamp, body)

    const wrongSecret = `whsec_${Buffer.from('totally-different-key-0000000000').toString('base64')}`
    const ok = verifyResendWebhook(body, { id, timestamp, signature: `v1,${sig}` }, wrongSecret)
    expect(ok).toBe(false)
  })

  it('rejects a tampered body (signature no longer matches)', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, timestamp, body)

    const tamperedBody = JSON.stringify({ type: 'email.delivered' })
    const ok = verifyResendWebhook(tamperedBody, { id, timestamp, signature: `v1,${sig}` }, SECRET)
    expect(ok).toBe(false)
  })

  it('rejects a forged signature', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })

    const ok = verifyResendWebhook(body, { id, timestamp, signature: 'v1,not-a-real-signature==' }, SECRET)
    expect(ok).toBe(false)
  })

  it.each(['id', 'timestamp', 'signature'] as const)('rejects a missing %s header', (missing) => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, timestamp, body)
    const headers = { id, timestamp, signature: `v1,${sig}` }
    headers[missing] = null as any

    const ok = verifyResendWebhook(body, headers, SECRET)
    expect(ok).toBe(false)
  })

  it('rejects a stale timestamp outside the tolerance window (replay protection)', () => {
    const id = 'msg_123'
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60) // 1 hour old
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, staleTimestamp, body)

    const ok = verifyResendWebhook(body, { id, timestamp: staleTimestamp, signature: `v1,${sig}` }, SECRET)
    expect(ok).toBe(false)
  })

  it('matches when ANY entry in a multi-entry svix-signature header is valid (key rotation)', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const validSig = sign(id, timestamp, body)
    const bogusSig = 'aW52YWxpZA=='

    const ok = verifyResendWebhook(
      body,
      { id, timestamp, signature: `v1,${bogusSig} v2,${validSig}` },
      SECRET,
    )
    expect(ok).toBe(true)
  })

  it('fails closed when no secret is configured', () => {
    const id = 'msg_123'
    const timestamp = nowTs()
    const body = JSON.stringify({ type: 'email.bounced' })
    const sig = sign(id, timestamp, body)

    const ok = verifyResendWebhook(body, { id, timestamp, signature: `v1,${sig}` }, '')
    expect(ok).toBe(false)
  })
})
