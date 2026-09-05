import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * #536 — MODEL_CONFIG's tier is a COMPUTE-COST-ROUTING concept (cheap/fast
 * model vs. expensive/slow model for code generation), a different axis from
 * the customer BILLING PLAN tier (hobbyist/pro/scale/enterprise) that
 * lib/ainative/plan.ts and lib/services/plan.service.ts already handle
 * correctly. The enum previously used 'free' | 'paid', which wrongly implied
 * some models cost nothing to run — AINative's DigitalOcean-hosted inference
 * is never actually free. This asserts the rename to 'standard' | 'premium'
 * (no "free" anywhere) is complete and internally consistent.
 *
 * The route module isn't imported directly: app/api/chat-ws/route.ts
 * instantiates OpenAI/Bedrock clients at module scope on import, which is
 * expensive/fragile to mock just to check a type-level rename. A source-text
 * assertion is the precedent used elsewhere in this suite (e.g.
 * __tests__/components/aikit-hardening.test.ts) for exactly this kind of
 * static-shape check.
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

describe('chat-ws MODEL_CONFIG tier naming (#536)', () => {
  it('never labels a model tier "free" or "paid" (cost-implying names)', () => {
    expect(routeSource).not.toMatch(/tier:\s*'free'/)
    expect(routeSource).not.toMatch(/tier:\s*'paid'/)
    expect(routeSource).not.toMatch(/\|\s*'free'\s*\|?\s*'?paid'?/)
    expect(routeSource).not.toContain('FREE_FALLBACKS')
    expect(routeSource).not.toContain('PAID_FALLBACKS')
  })

  it('defines the MODEL_CONFIG tier enum as standard | premium', () => {
    expect(routeSource).toMatch(
      /tier:\s*'standard'\s*\|\s*'premium'/,
    )
  })

  it('the fallback-default and fallback chains use the renamed values', () => {
    expect(routeSource).toContain("?.tier || 'standard'")
    expect(routeSource).toContain("modelTier === 'premium'")
    expect(routeSource).toContain('STANDARD_FALLBACKS')
    expect(routeSource).toContain('PREMIUM_FALLBACKS')
  })

  it('every MODEL_CONFIG entry uses only standard or premium as its tier', () => {
    const configBlockMatch = routeSource.match(
      /const MODEL_CONFIG:[^=]*=\s*\{([\s\S]*?)\n\}/,
    )
    expect(configBlockMatch).toBeTruthy()
    const block = configBlockMatch![1]

    const tierValues = [...block.matchAll(/tier:\s*'([^']+)'/g)].map((m) => m[1])
    expect(tierValues.length).toBeGreaterThanOrEqual(9)
    for (const v of tierValues) {
      expect(['standard', 'premium']).toContain(v)
    }
  })
})
