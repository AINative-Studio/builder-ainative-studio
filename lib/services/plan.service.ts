/**
 * Plan Service - Check user subscription and enforce token limits
 * Uses AINative billing API: GET /v1/public/billing
 * And managed usage API: GET /v1/managed/usage
 */

import { AINATIVE_API_BASE_URL } from '@/lib/constants'

export interface UserPlan {
  tier: 'hobbyist' | 'pro' | 'team' | 'enterprise'
  monthlyTokenLimit: number
  tokensUsed: number
  tokensRemaining: number
  maxTokensPerRequest: number
  models: string[]  // Models available on this plan
  defaultModel: string
}

// Aligned with ainative.studio pricing. Hobbyist ($5, 7-day trial) is the entry
// tier that replaced "free"; Pro $49, Business $149, Enterprise $699. Legacy
// billing values of "free" normalize to hobbyist below.
const PLAN_CONFIGS: Record<string, Omit<UserPlan, 'tokensUsed' | 'tokensRemaining'>> = {
  hobbyist: {
    tier: 'hobbyist',
    monthlyTokenLimit: 10_000,    // 10K LLM tokens
    maxTokensPerRequest: 4_000,
    models: ['qwen-coder-7b', 'gemma-2b', 'gemma-9b'],
    defaultModel: 'qwen-coder-7b',
  },
  pro: {
    tier: 'pro',
    monthlyTokenLimit: 1_000_000,  // 1M LLM tokens ($49/mo)
    maxTokensPerRequest: 32_000,
    models: ['claude-sonnet-4', 'claude-opus-4', 'qwen-coder-32b', 'nouscoder-14b', 'qwen-coder-7b', 'gemma-9b'],
    defaultModel: 'claude-sonnet-4',
  },
  team: {
    tier: 'team',
    monthlyTokenLimit: 5_000_000,  // 5M LLM tokens ($149/mo)
    maxTokensPerRequest: 32_000,
    models: ['claude-sonnet-4', 'claude-opus-4', 'claude-sonnet-4.5', 'qwen-coder-32b', 'nouscoder-14b', 'qwen-coder-7b'],
    defaultModel: 'claude-sonnet-4',
  },
  enterprise: {
    tier: 'enterprise',
    monthlyTokenLimit: 10_000_000, // 10M LLM tokens ($699/mo)
    maxTokensPerRequest: 32_000,
    models: ['claude-sonnet-4', 'claude-opus-4', 'claude-sonnet-4.5', 'claude-3-5-haiku', 'qwen-coder-32b', 'nouscoder-14b'],
    defaultModel: 'claude-sonnet-4',
  },
}

/**
 * Get user's plan from AINative billing API
 */
export async function getUserPlan(accessToken: string): Promise<UserPlan> {
  try {
    // Fetch billing info and usage in parallel
    const [billingRes, usageRes] = await Promise.allSettled([
      fetch(`${AINATIVE_API_BASE_URL}/v1/public/billing`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
      fetch(`${AINATIVE_API_BASE_URL}/v1/managed/usage?period=month`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }),
    ])

    // Determine tier from billing response. Default hobbyist (entry tier that
    // replaced free); legacy "free"/"starter"/"basic" values normalize to it.
    let tier = 'hobbyist'
    if (billingRes.status === 'fulfilled' && billingRes.value.ok) {
      const billing = await billingRes.value.json()
      const raw = String(billing?.data?.plan?.tier || billing?.plan || billing?.tier || 'hobbyist').toLowerCase()
      tier = ['free', 'basic', 'starter', 'trial', 'hobbyist'].includes(raw) ? 'hobbyist' : raw
    }

    // Get usage from managed API
    let tokensUsed = 0
    if (usageRes.status === 'fulfilled' && usageRes.value.ok) {
      const usage = await usageRes.value.json()
      tokensUsed = usage?.total_tokens || usage?.tokens_used || 0
    }

    const planConfig = PLAN_CONFIGS[tier] || PLAN_CONFIGS.hobbyist
    return {
      ...planConfig,
      tokensUsed,
      tokensRemaining: Math.max(0, planConfig.monthlyTokenLimit - tokensUsed),
    }
  } catch (error) {
    console.error('[Plan Service] Error fetching plan:', error)
    // Default to the Hobbyist (entry) plan on error — never over-grant.
    return {
      ...PLAN_CONFIGS.hobbyist,
      tokensUsed: 0,
      tokensRemaining: PLAN_CONFIGS.hobbyist.monthlyTokenLimit,
    }
  }
}

/**
 * Get plan for non-AINative users (guest/regular)
 */
export function getDefaultPlan(userType: string): UserPlan {
  if (userType === 'guest') {
    return {
      tier: 'hobbyist',
      monthlyTokenLimit: 10_000,
      tokensUsed: 0,
      tokensRemaining: 10_000,
      maxTokensPerRequest: 4_000,
      models: ['qwen-coder-7b', 'gemma-2b'],
      defaultModel: 'qwen-coder-7b',
    }
  }

  // Regular (local account) users get pro-like access
  return {
    ...PLAN_CONFIGS.pro,
    tokensUsed: 0,
    tokensRemaining: PLAN_CONFIGS.pro.monthlyTokenLimit,
  }
}

/**
 * Check if a model is allowed for the user's plan
 */
export function isModelAllowed(plan: UserPlan, model: string): boolean {
  return plan.models.includes(model)
}

/**
 * Get the effective model for a request (fallback to plan default if requested model not allowed)
 */
export function getEffectiveModel(plan: UserPlan, requestedModel?: string): string {
  if (!requestedModel) return plan.defaultModel
  return isModelAllowed(plan, requestedModel) ? requestedModel : plan.defaultModel
}
