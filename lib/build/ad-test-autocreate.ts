/**
 * Auto-create an ad-test campaign on build completion (#1017).
 *
 * THE GAP THIS CLOSES
 * #1016's live audit found 0 of 338 companies had ever completed an ad-test
 * campaign. The free, immediate `POST /api/build/growth/ad-test` route has
 * zero callers anywhere in the UI, and the path the Growth panel IS wired to
 * (`ad-budget-checkout`) asks a founder to pay $5-$50 upfront before they have
 * ever seen a campaign exist. Nobody opted in to a thing they could not see.
 *
 * So: the moment a founder's build is genuinely complete, create their real
 * campaign for them — PAUSED, no money involved, no founder input, nothing to
 * discover. The Growth panel then has something concrete to show ("your test
 * campaign is ready — add credits to launch it") instead of an abstract
 * pay-first offer.
 *
 * NO PLAN-TIER GATE (confirmed product direction, 2026-10-10 on #1017). Ad
 * validation is explicitly for ANY founder, free tier included — it is how a
 * founder proves demand for their idea, which is the whole reason ads are in
 * the product. This module therefore never imports or consults lib/ainative/plan.
 * The real gate is on ACTIVATION, not creation, and it is "has this founder
 * purchased prepaid ad credits" — enforced in
 * app/api/webhooks/ad-budget-confirmed/route.ts, behind an HMAC-verified
 * Stripe-payment callback. Purchasing credits is itself the founder's consent
 * to real spend.
 *
 * WHAT MAKES THIS SAFE TO FIRE AUTOMATICALLY
 *  - The campaign is PAUSED. `createAdTestCampaign` hardcodes that and exposes
 *    no status parameter, so this path structurally cannot start spend. The only
 *    activation path in the codebase is `activateAdTestCampaign`, reachable only
 *    from the paid-credits webhook.
 *  - No charge, no Stripe call, no budget commitment. The placeholder daily
 *    budget below is never spent (a PAUSED campaign has no delivery); the real
 *    budget is whatever the founder's credits fund at activation time.
 *  - IDEMPOTENT on the company's existing `growthAdTestCampaignId` — the SAME
 *    registry field and the SAME `setAppGrowthAdTest` setter the manual
 *    endpoint already uses, so the manual path, this path and the webhook all
 *    read and write one piece of state and can never create a duplicate.
 *  - Doubly gated, exactly like every other ad path: the
 *    GROWTH_AD_TESTING_ENABLED flag AND a real Marketing API credential. Both
 *    are off in production today, so enabling this is a deliberate act.
 *  - NEVER THROWS. Callers are registration and the #1015 reconciliation sweep;
 *    a Meta hiccup must not fail a founder's registration or abort a sweep.
 *
 * The existing manual `POST /api/build/growth/ad-test` endpoint is deliberately
 * left alone, paid-tier check included. Its gate predates the 2026-10-10
 * direction and changing a founder-facing endpoint's entitlement is a separate,
 * reviewable decision; this module adds the new automatic path without that
 * gate rather than quietly re-scoping the old one.
 */

import { resolveAppVerified, setAppGrowthAdTest } from '@/lib/build/app-registry'
import {
  createAdTestCampaign,
  growthAdTestingEnabled,
  growthAdTestingCredentialConfigured,
  DEFAULT_DAILY_BUDGET_USD,
} from '@/lib/build/ad-testing'

/**
 * The daily budget a PAUSED auto-created campaign carries. Not a spend
 * commitment: a PAUSED campaign has no delivery, and the real budget is set
 * from the founder's actual prepaid credits at activation time.
 */
export const AUTO_CREATE_PLACEHOLDER_BUDGET_USD = DEFAULT_DAILY_BUDGET_USD

export interface AutoCreateAdTestResult {
  /** True ONLY when a new real campaign was created and persisted on this call. */
  created: boolean
  /** The company's campaign id — the new one, or the pre-existing one on a no-op. */
  campaignId?: string
  /** Populated on every non-creation outcome. Never fabricated. */
  reason?: string
}

/**
 * Auto-create the company's PAUSED ad-test campaign, if it doesn't have one.
 *
 * Safe to call on every build completion and on every reconciliation pass —
 * repeated calls for a company that already has a campaign are strict no-ops.
 */
export async function autoCreateAdTestCampaign(slug: string): Promise<AutoCreateAdTestResult> {
  // Cheap, env-only guards first, so a disabled environment never even reads
  // the registry.
  if (!growthAdTestingEnabled()) return { created: false, reason: 'disabled' }
  if (!growthAdTestingCredentialConfigured()) {
    return { created: false, reason: 'credential_not_configured' }
  }
  if (!slug?.trim()) return { created: false, reason: 'slug_required' }

  try {
    // #1494: resolveAppVerified(), not resolveApp(). A transient registry read
    // failure used to come back as the SAME `null` a confirmed-missing company
    // returns, so a real founder's company was reported as
    // `company_not_found` — a confirmed, terminal-sounding answer — when the
    // read simply never completed. The outcome is the same either way (no
    // campaign is created, which is the safe direction), but the REASON must
    // tell the #1015 reconciliation sweep and anyone reading a log that this
    // one is worth retrying rather than a company that genuinely isn't there.
    const lookup = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))
    if (!lookup.verified) return { created: false, reason: 'lookup_failed' }
    const app = lookup.entry
    if (!app) return { created: false, reason: 'company_not_found' }

    // IDEMPOTENCE. Shared with the manual endpoint and the funding webhook via
    // the one registry field, so no path can create a second campaign.
    if (app.growthAdTestCampaignId) {
      return { created: false, campaignId: app.growthAdTestCampaignId, reason: 'already_exists' }
    }

    const result = await createAdTestCampaign({
      companyName: app.name || slug,
      tagline: app.tagline,
      dailyBudgetUsd: AUTO_CREATE_PLACEHOLDER_BUDGET_USD,
    })
    if (!result.ok || !result.campaignId) {
      return { created: false, reason: result.reason || 'campaign_create_failed' }
    }

    // Persisted through the EXISTING setter — same field, same pattern.
    await setAppGrowthAdTest(slug, { campaignId: result.campaignId }).catch(() => {})

    return { created: true, campaignId: result.campaignId }
  } catch (err) {
    return { created: false, reason: String((err as Error)?.message || err).slice(0, 160) }
  }
}
