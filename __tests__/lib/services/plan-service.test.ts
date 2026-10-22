import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for plan.service.ts: user plan/tier resolution against the
 * AINative billing + usage APIs (mocked via global fetch), plus the pure
 * model-allowlist helpers.
 */

describe('getUserPlan', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('resolves the pro tier from a successful billing response and sums usage', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/billing')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { plan: { tier: 'pro' } } }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ total_tokens: 250_000 }),
      })
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('access-token')

    expect(plan.tier).toBe('pro')
    expect(plan.monthlyTokenLimit).toBe(1_000_000)
    expect(plan.tokensUsed).toBe(250_000)
    expect(plan.tokensRemaining).toBe(750_000)
  })

  it('normalizes legacy "free"/"starter"/"trial" tier values to hobbyist', async () => {
    for (const legacy of ['free', 'starter', 'trial', 'basic']) {
      global.fetch = vi.fn((url: string) => {
        if (url.includes('/billing')) {
          return Promise.resolve({ ok: true, json: async () => ({ plan: legacy }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ tokens_used: 0 }) })
      }) as any

      const { getUserPlan } = await import('@/lib/services/plan.service')
      const plan = await getUserPlan('token')
      expect(plan.tier).toBe('hobbyist')
    }
  })

  it('defaults to hobbyist when the billing request fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/billing')) {
        return Promise.resolve({ ok: false, status: 500 })
      }
      return Promise.resolve({ ok: true, json: async () => ({ total_tokens: 0 }) })
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('token')

    expect(plan.tier).toBe('hobbyist')
  })

  it('treats a 0 usage result as 0 tokens used when the usage request fails', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/billing')) {
        return Promise.resolve({ ok: true, json: async () => ({ tier: 'team' }) })
      }
      return Promise.resolve({ ok: false, status: 503 })
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('token')

    expect(plan.tier).toBe('team')
    expect(plan.tokensUsed).toBe(0)
    expect(plan.tokensRemaining).toBe(plan.monthlyTokenLimit)
  })

  it('clamps tokensRemaining to 0 when usage exceeds the monthly limit', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/billing')) {
        return Promise.resolve({ ok: true, json: async () => ({ tier: 'hobbyist' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ total_tokens: 999_999_999 }) })
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('token')

    expect(plan.tokensRemaining).toBe(0)
  })

  it('falls back to the hobbyist plan entirely when fetch itself throws', async () => {
    global.fetch = vi.fn(() => {
      throw new Error('network down')
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('token')

    expect(plan.tier).toBe('hobbyist')
    expect(plan.tokensUsed).toBe(0)
    expect(plan.tokensRemaining).toBe(plan.monthlyTokenLimit)
  })

  it('falls back to the hobbyist default when an unrecognized tier value is returned', async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes('/billing')) {
        return Promise.resolve({ ok: true, json: async () => ({ tier: 'nonexistent-tier' }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ total_tokens: 0 }) })
    }) as any

    const { getUserPlan } = await import('@/lib/services/plan.service')
    const plan = await getUserPlan('token')

    // PLAN_CONFIGS[tier] lookup misses -> falls back to PLAN_CONFIGS.hobbyist
    expect(plan.tier).toBe('hobbyist')
  })
})

describe('getDefaultPlan', () => {
  it('returns the guest plan for userType "guest"', async () => {
    const { getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('guest')

    expect(plan.tier).toBe('hobbyist')
    expect(plan.monthlyTokenLimit).toBe(10_000)
    expect(plan.tokensRemaining).toBe(10_000)
  })

  it('returns a pro-like plan for any non-guest userType', async () => {
    const { getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('regular')

    expect(plan.tier).toBe('pro')
    expect(plan.tokensUsed).toBe(0)
    expect(plan.tokensRemaining).toBe(plan.monthlyTokenLimit)
  })
})

describe('isModelAllowed', () => {
  it('returns true when the model is in the plan allowlist', async () => {
    const { isModelAllowed, getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('regular')

    expect(isModelAllowed(plan, plan.models[0])).toBe(true)
  })

  it('returns false when the model is not in the plan allowlist', async () => {
    const { isModelAllowed, getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('guest')

    expect(isModelAllowed(plan, 'gpt-4-totally-unsupported')).toBe(false)
  })
})

describe('getEffectiveModel', () => {
  it('returns the plan default model when no model is requested', async () => {
    const { getEffectiveModel, getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('guest')

    expect(getEffectiveModel(plan)).toBe(plan.defaultModel)
  })

  it('returns the requested model when it is allowed', async () => {
    const { getEffectiveModel, getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('regular')
    const allowedModel = plan.models[1]

    expect(getEffectiveModel(plan, allowedModel)).toBe(allowedModel)
  })

  it('falls back to the plan default when the requested model is not allowed', async () => {
    const { getEffectiveModel, getDefaultPlan } = await import('@/lib/services/plan.service')
    const plan = getDefaultPlan('guest')

    expect(getEffectiveModel(plan, 'not-a-real-model')).toBe(plan.defaultModel)
  })
})
