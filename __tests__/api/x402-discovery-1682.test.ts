import { describe, it, expect } from 'vitest'
import { GET } from '@/app/.well-known/x402/route'

/**
 * #1682 — x402 Agent Payment Discovery AX gap. Discovery-only doc: must
 * honestly report no payment execution is supported, per the deliberate
 * scope decision in app/api/agent402/[action]/route.ts.
 *
 * Originally shipped as a static public/.well-known/x402 file, which 404'd
 * in production (Next.js does not reliably serve extensionless static
 * files). Converted to a real route handler — see app/.well-known/x402/route.ts.
 */
describe('GET /.well-known/x402', () => {
  it('returns 200 and reports x402 payment execution as unsupported', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.x402_supported).toBe(false)
  })

  it('points at the real read-only Agent402 endpoints, not a payment endpoint', async () => {
    const res = await GET()
    const doc = await res.json()
    const paths = doc.related_integration.endpoints.map((e: { path: string }) => e.path)
    expect(paths).toContain('https://builder.ainative.studio/api/agent402/capabilities')
    expect(paths).toContain('https://builder.ainative.studio/api/agent402/projects')
    expect(paths.every((p: string) => !/payment|charge|execute/i.test(p))).toBe(true)
  })

  it('does not contain live payment/execution fields', async () => {
    const res = await GET()
    const doc = await res.json()
    expect(doc).not.toHaveProperty('payment_endpoint')
    expect(doc).not.toHaveProperty('wallet_address')
    expect(doc).not.toHaveProperty('challenge')
  })

  it('is cacheable', async () => {
    const res = await GET()
    expect(res.headers.get('Cache-Control')).toContain('max-age')
  })
})
