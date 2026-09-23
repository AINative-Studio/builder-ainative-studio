import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #840 — POST /api/webhooks/resend. The real, structural fix for Resend's
 * silent-bounce gap: Resend returns a clean 2xx for a suppressed/bounced
 * recipient at send time, then drops the email server-side, async — with no
 * webhook handler anywhere in this codebase (confirmed by search) to catch
 * it. Contracts under test:
 *  - the HTTP layer 401s on an invalid/missing signature, never calling the
 *    registry;
 *  - a genuinely durable event (permanent email.bounced, or email.complained)
 *    flags every company owned by the recipient address as undeliverable;
 *  - a TRANSIENT bounce (bounce.type !== 'Permanent') is explicitly NOT
 *    treated as a durable "give up" signal;
 *  - an unrelated event type (email.delivered/opened/etc.) is accepted
 *    (200) as a no-op, never flags anything — Resend needs a 2xx or it
 *    keeps retrying;
 *  - an event with no recipient list is handled honestly, never throws;
 *  - a registry failure inside markEmailUndeliverableForAddress never
 *    throws — the webhook handler must survive a downstream hiccup.
 * All collaborators are mocked; no real network call is made.
 */

const h = vi.hoisted(() => ({
  markEmailUndeliverableForAddress: vi.fn<(email: string, reason: string) => Promise<string[]>>(async () => []),
}))

vi.mock('@/lib/build/app-registry', () => ({
  markEmailUndeliverableForAddress: h.markEmailUndeliverableForAddress,
}))

import { handleResendWebhookEvent, POST } from '@/app/api/webhooks/resend/route'
import { createHmac } from 'crypto'

const SECRET_RAW = Buffer.from('resend-webhook-test-secret-000000')
const SECRET = `whsec_${SECRET_RAW.toString('base64')}`

function sign(id: string, timestamp: string, body: string): string {
  return createHmac('sha256', SECRET_RAW).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function makeRequest(bodyObj: object, opts: { validSig?: boolean } = { validSig: true }) {
  const body = JSON.stringify(bodyObj)
  const id = 'msg_1'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = opts.validSig === false ? 'v1,bm90LXZhbGlk' : `v1,${sign(id, timestamp, body)}`
  return {
    text: async () => body,
    headers: {
      get: (k: string) => {
        const map: Record<string, string> = {
          'svix-id': id,
          'svix-timestamp': timestamp,
          'svix-signature': signature,
        }
        return map[k.toLowerCase()] ?? null
      },
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  h.markEmailUndeliverableForAddress.mockResolvedValue([])
})

describe('POST /api/webhooks/resend — signature gate (#840)', () => {
  it('401s on an invalid signature and never touches the registry', async () => {
    const res: any = await POST(makeRequest({ type: 'email.bounced', data: { to: ['a@b.com'] } }, { validSig: false }))
    expect(res.status).toBe(401)
    expect(h.markEmailUndeliverableForAddress).not.toHaveBeenCalled()
  })

  it('401s when the secret is unconfigured (fails closed)', async () => {
    process.env.RESEND_WEBHOOK_SECRET = ''
    const res: any = await POST(makeRequest({ type: 'email.bounced', data: { to: ['a@b.com'] } }))
    expect(res.status).toBe(401)
  })

  it('200s on a valid signature', async () => {
    const res: any = await POST(makeRequest({
      type: 'email.bounced',
      data: { to: ['a@b.com'], bounce: { type: 'Permanent', subType: 'Suppressed' } },
    }))
    expect(res.status).toBe(200)
  })
})

describe('handleResendWebhookEvent (#840)', () => {
  it('flags every company owned by the recipient on a PERMANENT bounce', async () => {
    h.markEmailUndeliverableForAddress.mockResolvedValue(['acme', 'beta'])

    const result = await handleResendWebhookEvent({
      type: 'email.bounced',
      data: { to: ['admin@ainative.studio'], bounce: { type: 'Permanent', subType: 'Suppressed', message: 'on the suppression list' } },
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('flagged')
    expect(result.flaggedSlugs).toEqual(['acme', 'beta'])
    expect(h.markEmailUndeliverableForAddress).toHaveBeenCalledWith('admin@ainative.studio', 'bounced:Suppressed')
  })

  it('flags on email.complained (no bounce sub-object needed)', async () => {
    h.markEmailUndeliverableForAddress.mockResolvedValue(['acme'])

    const result = await handleResendWebhookEvent({
      type: 'email.complained',
      data: { to: ['founder@x.com'] },
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('flagged')
    expect(h.markEmailUndeliverableForAddress).toHaveBeenCalledWith('founder@x.com', 'complained')
  })

  it('does NOT flag a TRANSIENT bounce (bounce.type !== Permanent)', async () => {
    const result = await handleResendWebhookEvent({
      type: 'email.bounced',
      data: { to: ['founder@x.com'], bounce: { type: 'Transient', subType: 'MailboxFull' } },
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('transient_bounce_ignored')
    expect(h.markEmailUndeliverableForAddress).not.toHaveBeenCalled()
  })

  it('ignores an unrelated event type as a no-op (still 200/ok, never flags)', async () => {
    const result = await handleResendWebhookEvent({ type: 'email.delivered', data: { to: ['founder@x.com'] } })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('ignored_event_type:email.delivered')
    expect(h.markEmailUndeliverableForAddress).not.toHaveBeenCalled()
  })

  it('handles a bounce event with no recipient list honestly, never throws', async () => {
    const result = await handleResendWebhookEvent({
      type: 'email.bounced',
      data: { bounce: { type: 'Permanent' } } as any,
    })

    expect(result.ok).toBe(true)
    expect(result.reason).toBe('no_recipients')
    expect(h.markEmailUndeliverableForAddress).not.toHaveBeenCalled()
  })

  it('flags every recipient address when multiple are present', async () => {
    h.markEmailUndeliverableForAddress
      .mockResolvedValueOnce(['acme'])
      .mockResolvedValueOnce(['beta'])

    const result = await handleResendWebhookEvent({
      type: 'email.bounced',
      data: { to: ['a@x.com', 'b@x.com'], bounce: { type: 'Permanent' } },
    })

    expect(h.markEmailUndeliverableForAddress).toHaveBeenCalledTimes(2)
    expect(result.flaggedSlugs).toEqual(['acme', 'beta'])
  })

  it('never throws even if markEmailUndeliverableForAddress rejects', async () => {
    h.markEmailUndeliverableForAddress.mockRejectedValue(new Error('zerodb down'))

    const result = await handleResendWebhookEvent({
      type: 'email.bounced',
      data: { to: ['a@x.com'], bounce: { type: 'Permanent' } },
    })

    expect(result.ok).toBe(true)
    expect(result.flaggedSlugs).toEqual([])
  })
})
