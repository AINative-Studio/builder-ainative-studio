import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #1682 — x402 Agent Payment Discovery AX gap. Discovery-only doc: must
 * honestly report no payment execution is supported, per the deliberate
 * scope decision in app/api/agent402/[action]/route.ts.
 */
describe('public/.well-known/x402', () => {
  const doc = JSON.parse(
    readFileSync(join(process.cwd(), 'public/.well-known/x402'), 'utf-8'),
  )

  it('reports x402 payment execution as unsupported', () => {
    expect(doc.x402_supported).toBe(false)
  })

  it('points at the real read-only Agent402 endpoints, not a payment endpoint', () => {
    const paths = doc.related_integration.endpoints.map((e: { path: string }) => e.path)
    expect(paths).toContain('https://builder.ainative.studio/api/agent402/capabilities')
    expect(paths).toContain('https://builder.ainative.studio/api/agent402/projects')
    expect(paths.every((p: string) => !/payment|charge|execute/i.test(p))).toBe(true)
  })

  it('does not contain live payment/execution fields', () => {
    expect(doc).not.toHaveProperty('payment_endpoint')
    expect(doc).not.toHaveProperty('wallet_address')
    expect(doc).not.toHaveProperty('challenge')
  })
})
