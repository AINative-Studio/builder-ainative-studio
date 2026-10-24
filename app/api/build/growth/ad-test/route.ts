/**
 * /api/build/growth/ad-test (#449, child of the 2026-09-01 product call) —
 * explicit, founder-triggered "create a test ad campaign" action.
 *
 * Gated on:
 *   1. GROWTH_AD_TESTING_ENABLED=true (feature flag, default off)
 *   2. A real Marketing API credential actually configured (separate check —
 *      the flag could be flipped on before the credential is provisioned)
 *   3. Signed-in founder
 *   4. A resolvable company
 *
 * Creates exactly ONE real, PAUSED Meta Ads campaign — never auto-activated,
 * no real spend, no billing of any kind (the reseller-margin billing model
 * needs core support that doesn't exist yet, tracked separately as core#6835).
 *
 * NO PLAN-TIER GATE (#1017, product direction confirmed 2026-10-10). This
 * route used to require `isPaidTier`. It no longer does, for two reasons that
 * both point the same way:
 *
 *   - Ad validation is explicitly for ANY founder, free tier included — it is
 *     how a founder proves demand for their idea. The real gate is ACTIVATION,
 *     and that gate is "has this founder purchased prepaid ad credits",
 *     enforced in app/api/webhooks/ad-budget-confirmed/route.ts behind an
 *     HMAC-verified Stripe-payment callback.
 *   - #1017's auto-create path (lib/build/ad-test-autocreate.ts) performs this
 *     EXACT operation — same `createAdTestCampaign`, same PAUSED status, same
 *     `setAppGrowthAdTest` field, same idempotence — with no tier gate, for
 *     every founder whose build completes. Keeping a gate here protected
 *     nothing that path doesn't already (correctly) bypass; all it produced was
 *     the incoherent result that a free founder's campaign is created
 *     automatically but their own manual re-trigger of it is refused.
 *
 * Creation remains structurally incapable of spending money: `createAdTestCampaign`
 * hardcodes status PAUSED and exposes no status parameter, and this route is
 * idempotent on the company's existing `growthAdTestCampaignId`, so a signed-in
 * founder cannot use it to accumulate campaigns.
 *
 * POST { slug, dailyBudgetUsd? } → { ok, campaignId?, reason? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveAppVerified, setAppGrowthAdTest } from '@/lib/build/app-registry'
import {
  createAdTestCampaign,
  growthAdTestingEnabled,
  growthAdTestingCredentialConfigured,
  DEFAULT_DAILY_BUDGET_USD,
  MAX_DAILY_BUDGET_USD,
} from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

// #1017: the two budget constants moved to lib/build/ad-testing.ts (the
// auto-create path needs the same DEFAULT and can't import a route module).
// Re-exported here so any existing importer of this route keeps working and
// this route's own behavior is unchanged. MAX is a per-DAY ceiling on the
// PAUSED campaign's own budget field — unrelated to the TOTAL prepaid credit
// amounts offered at checkout.
export { DEFAULT_DAILY_BUDGET_USD, MAX_DAILY_BUDGET_USD }

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

  // Sign-in stays required: campaign creation writes to a real company's
  // registry row and uses AINative's own Meta ad account, so it must never be
  // reachable anonymously.
  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  // #832-class bug: resolveApp()'s plain `null` return collapsed "no such
  // company" with "the registry read itself failed" — a transient ZeroDB
  // hiccup here would falsely block a founder from creating their test ad
  // campaign with "company not found".
  const { entry: app, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
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
