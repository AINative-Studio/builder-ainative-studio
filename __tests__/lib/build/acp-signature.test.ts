import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

/**
 * #1838 — Builder-side ACP request signer. MUST produce the exact same
 * signature core's own `verify_acp_signature` (src/backend/app/services/
 * acp_signature.py) expects: HMAC-SHA256 over
 * "{METHOD}\n{path}\n{timestamp}\n" + raw body, hex digest, "sha256=" prefix.
 * Verified against a hand-computed reference signature, not just "it runs."
 */
describe('signAcpRequest', () => {
  const originalSecret = process.env.ACP_SIGNING_SECRET

  beforeEach(() => {
    process.env.ACP_SIGNING_SECRET = 'test-shared-secret'
  })

  afterEach(() => {
    process.env.ACP_SIGNING_SECRET = originalSecret
  })

  it('produces the exact canonical HMAC-SHA256 signature core expects', async () => {
    const { signAcpRequest } = await import('@/lib/build/acp-signature')

    const method = 'POST'
    const path = '/checkout_sessions'
    const timestampSeconds = 1762300000
    const body = '{"items":[{"id":"Pro","quantity":1}]}'

    const { signature, timestamp } = signAcpRequest({ method, path, timestampSeconds, body })

    expect(timestamp).toBe('1762300000')

    const expectedCanonical = Buffer.concat([
      Buffer.from(`${method}\n${path}\n${timestamp}\n`, 'utf-8'),
      Buffer.from(body, 'utf-8'),
    ])
    const expectedDigest = createHmac('sha256', 'test-shared-secret').update(expectedCanonical).digest('hex')
    expect(signature).toBe(`sha256=${expectedDigest}`)
  })

  it('uppercases the method in the canonical string', async () => {
    const { signAcpRequest } = await import('@/lib/build/acp-signature')
    const lower = signAcpRequest({ method: 'post', path: '/checkout_sessions', timestampSeconds: 1, body: '{}' })
    const upper = signAcpRequest({ method: 'POST', path: '/checkout_sessions', timestampSeconds: 1, body: '{}' })
    expect(lower.signature).toBe(upper.signature)
  })

  it('produces a different signature for a different path (signature is not transferable across endpoints)', async () => {
    const { signAcpRequest } = await import('@/lib/build/acp-signature')
    const a = signAcpRequest({ method: 'POST', path: '/checkout_sessions', timestampSeconds: 1, body: '{}' })
    const b = signAcpRequest({ method: 'POST', path: '/agentic_commerce/delegate_payment', timestampSeconds: 1, body: '{}' })
    expect(a.signature).not.toBe(b.signature)
  })
})

describe('isAcpSigningConfigured', () => {
  const originalSecret = process.env.ACP_SIGNING_SECRET

  afterEach(() => {
    process.env.ACP_SIGNING_SECRET = originalSecret
  })

  it('returns false when ACP_SIGNING_SECRET is not set', async () => {
    delete process.env.ACP_SIGNING_SECRET
    const { isAcpSigningConfigured } = await import('@/lib/build/acp-signature')
    expect(isAcpSigningConfigured()).toBe(false)
  })

  it('returns true when ACP_SIGNING_SECRET is set', async () => {
    process.env.ACP_SIGNING_SECRET = 'some-secret'
    const { isAcpSigningConfigured } = await import('@/lib/build/acp-signature')
    expect(isAcpSigningConfigured()).toBe(true)
  })
})
