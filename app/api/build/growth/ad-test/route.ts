/**
 * /api/build/growth/ad-test (#449, child of the 2026-09-01 product call) —
 * explicit, founder-triggered "create a test ad campaign" action.
 *
 * Doubly gated, matching the issue's own scope decision:
 *   1. GROWTH_AD_TESTING_ENABLED=true (feature flag, default off)
 *   2. A real Marketing API credential actually configured (separate check —
 *      the flag could be flipped on before the credential is provisioned)
 *   3. Paid tier (same PAID_PLANS check provision/route.ts already uses)
 *   4. Signed-in founder
 *
 * Creates exactly ONE real, PAUSED Meta Ads campaign — never auto-activated,
 * no real spend, no billing of any kind (the reseller-margin billing model
 * needs core support that doesn't exist yet, tracked separately as core#6835).
 *
 * POST { slug, dailyBudgetUsd? } → { ok, campaignId?, reason? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { resolveApp, setAppGrowthAdTest } from '@/lib/build/app-registry'
import { createAdTestCampaign, growthAdTestingEnabled, growthAdTestingCredentialConfigured } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

// Same set provision/route.ts already gates real provisioning behind.
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

const DEFAULT_DAILY_BUDGET_USD = 5
const MAX_DAILY_BUDGET_USD = 25

export async function POST(request: NextRequest) {
  if (!growthAdTestingEnabled()) {
    return Response.json({ ok: false, reason: 'disabled', detail: 'Growth ad-testing is not enabled in this environment.' })
  }
  if (!growthAdTestingCredentialConfigured()) {
    return Response.json({ ok: false, reason: 'credential_not_configured', detail: 'No Meta Ads Marketing API credential is configured.' })
  }

  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const rawBudget = Number(body?.dailyBudgetUsd)
  const dailyBudgetUsd = Number.isFinite(rawBudget) && rawBudget > 0
    ? Math.min(rawBudget, MAX_DAILY_BUDGET_USD)
    : DEFAULT_DAILY_BUDGET_USD

  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  let tier = 'hobbyist'
  try {
    const status = await getPlanStatus(token)
    tier = status.tier || 'hobbyist'
  } catch {
    // Fail closed to the un-paid default — never grant a real ad campaign
    // creation on an unresolved tier lookup.
  }
  if (!PAID_PLANS.has(tier)) {
    return Response.json({ ok: false, reason: 'tier', tier })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  // Already has a test campaign — return it rather than creating a duplicate.
  if (app.growthAdTestCampaignId) {
    return Response.json({ ok: true, campaignId: app.growthAdTestCampaignId })
  }

  const result = await createAdTestCampaign({
    companyName: app.name || slug,
    tagline: app.tagline,
    dailyBudgetUsd,
  })
  if (!result.ok || !result.campaignId) {
    return Response.json({ ok: false, reason: result.reason || 'campaign_create_failed', status: result.status })
  }

  await setAppGrowthAdTest(slug, { campaignId: result.campaignId }).catch(() => {})

  return Response.json({ ok: true, campaignId: result.campaignId })
}
