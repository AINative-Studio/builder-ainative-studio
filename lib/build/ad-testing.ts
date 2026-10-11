/**
 * Growth module — automated ad-testing (#449, child of the 2026-09-01 product
 * call). Toby committed to surfacing a "Growth" section where paid founders
 * get an automated ad-testing layer to validate their product.
 *
 * FULL SCOPE NOW SHIPPED: builder uses AINative's OWN Meta ad account (not
 * the founder's), charges the founder the full requested amount, and only
 * ever submits 80% of it to Meta as the real budget — the 20% margin is
 * captured by never telling Meta the full amount, computed server-side on
 * core (app/api/v1/endpoints/ad_budget.py), never trusted from the client.
 * See app/api/build/growth/ad-budget-checkout/route.ts (payment init) and
 * app/api/webhooks/ad-budget-confirmed/route.ts (the ONLY place a real
 * campaign gets created, gated on a verified Stripe payment via core's
 * webhook). `createAdTestCampaign` is still hardcoded PAUSED and has no
 * caller-overridable status — it structurally cannot start spend.
 *
 * #1017 ADDS ONE (and only one) ACTIVATION PATH: `activateAdTestCampaign`,
 * which flips an existing PAUSED campaign to ACTIVE. It is reachable from
 * exactly one place — the HMAC-verified ad-budget-confirmed webhook, after a
 * founder's prepaid ad credits are confirmed paid. Purchasing credits is the
 * consent to real spend; activation is NOT gated on plan tier, since a
 * free-tier founder who bought credits is explicitly entitled to run a
 * validation campaign (#1017 product direction, 2026-10-10).
 *
 * REAL INTEGRATION LAYER — corrected during implementation: the
 * `mcp__meta-ads__*` tools available in an interactive agent session are NOT
 * callable from a deployed Next.js server — they're this session's own MCP
 * tool layer, not a production HTTP client. This module calls Meta's real
 * Graph Marketing API directly (the same underlying API those MCP tools
 * wrap) via `METAADS_ACCESS_TOKEN`/`METAADS_AD_ACCOUNT_ID` env vars. Neither
 * is configured on builder's production service today (confirmed via
 * `railway variables` — only `META_API_KEY`/`META_BASE_URL` exist, and
 * those are Meta's LLM inference API, a real but unrelated credential, easy
 * to confuse with Marketing API access). So this feature is doubly gated:
 * the feature flag below AND a missing-credential check both fail closed
 * until a real Marketing API token is actually provisioned.
 */

const GRAPH_API_BASE = process.env.META_GRAPH_API_BASE || 'https://graph.facebook.com/v21.0'

/**
 * Daily-budget bounds for an ad-test campaign, in whole USD.
 *
 * #1017 moved these here from app/api/build/growth/ad-test/route.ts (which
 * still re-exports them, so that route's behavior is byte-identical) because
 * the auto-create path needs the same DEFAULT without importing a route
 * module into a library.
 *
 * DEFAULT is the placeholder a PAUSED auto-created campaign carries: it is
 * never spent, since a PAUSED campaign has no delivery, and the real budget is
 * whatever the founder's prepaid credits actually fund at activation time.
 */
export const DEFAULT_DAILY_BUDGET_USD = 5
export const MAX_DAILY_BUDGET_USD = 25

export function growthAdTestingEnabled(): boolean {
  return process.env.GROWTH_AD_TESTING_ENABLED === 'true'
}

/** True only when a real Marketing API credential is actually configured — distinct
 *  from the feature flag, since the flag could be flipped on before the credential
 *  is provisioned; both must be true before any real API call is attempted. */
export function growthAdTestingCredentialConfigured(): boolean {
  return Boolean(process.env.METAADS_ACCESS_TOKEN && process.env.METAADS_AD_ACCOUNT_ID)
}

export interface AdTestCampaignInput {
  companyName: string
  tagline?: string
  /** Daily budget in whole USD (call transcript: $5-$25/day depending on tier). */
  dailyBudgetUsd: number
}

export interface AdTestCampaignResult {
  ok: boolean
  campaignId?: string
  reason?: string
  status?: number
}

/**
 * Create ONE real, PAUSED Meta Ads campaign for a company to review — never
 * auto-activated (status is hardcoded PAUSED, not caller-overridable), so no
 * real spend occurs until a human explicitly launches it in Meta Ads Manager
 * or a future, separate "activate" action. Never throws — a create failure
 * (including the credential not being configured) is surfaced as a
 * structured, honest result.
 *
 * Real contract: POST {GRAPH_API_BASE}/act_{account_id}/campaigns — Meta's
 * documented Marketing API campaign-create endpoint (the same one the
 * mcp__meta-ads__create_campaign tool wraps for interactive use).
 */
export async function createAdTestCampaign(input: AdTestCampaignInput): Promise<AdTestCampaignResult> {
  if (!growthAdTestingCredentialConfigured()) return { ok: false, reason: 'credential_not_configured' }
  if (!input.companyName?.trim()) return { ok: false, reason: 'company_name_required' }
  if (!Number.isFinite(input.dailyBudgetUsd) || input.dailyBudgetUsd <= 0) {
    return { ok: false, reason: 'invalid_budget' }
  }

  const accessToken = process.env.METAADS_ACCESS_TOKEN as string
  const adAccountId = process.env.METAADS_AD_ACCOUNT_ID as string

  try {
    const res = await fetch(`${GRAPH_API_BASE}/act_${adAccountId}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        name: `${input.companyName} — Builder test campaign`,
        // OUTCOME_TRAFFIC is the safest first-pass objective for "validate the
        // product got some real eyes" — not OUTCOME_SALES, which needs a real
        // pixel/conversion setup this company likely doesn't have yet.
        objective: 'OUTCOME_TRAFFIC',
        // Hardcoded, not derived from any caller input — a real safety
        // invariant: this module must never be able to launch a live campaign.
        status: 'PAUSED',
        daily_budget: String(Math.round(input.dailyBudgetUsd * 100)), // Meta expects cents
        special_ad_categories: [],
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.error?.message || res.status).slice(0, 160) }
    }
    const campaignId = data?.id
    if (typeof campaignId !== 'string' || !campaignId) {
      return { ok: false, reason: 'campaign_response_missing_id' }
    }
    return { ok: true, campaignId, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

/**
 * Activate ONE already-created, PAUSED campaign (#1017) — the ONLY function in
 * this module that can start real spend, deliberately split out from
 * `createAdTestCampaign` so that function's hardcoded-PAUSED invariant stays
 * intact and un-weakened (no caller-overridable `status` was ever added there).
 *
 * CALL-SITE CONTRACT: this must only be reached once a founder's prepaid ad
 * credits are confirmed paid — i.e. from the HMAC-verified
 * /api/webhooks/ad-budget-confirmed callback, never from anything
 * client-triggered and never from the auto-create path. Purchasing credits IS
 * the founder's consent to real spend (#1017's product direction); nothing
 * else in the codebase is allowed to stand in for it. NOT gated on plan tier:
 * a free-tier founder who has bought credits is explicitly entitled to run a
 * validation campaign.
 *
 * Never throws — an activation failure (including the credential not being
 * configured) is surfaced as a structured, honest result, matching
 * createAdTestCampaign/fetchAdTestInsights.
 *
 * Real contract: POST {GRAPH_API_BASE}/{campaignId} with { status: 'ACTIVE' }
 * — Meta's documented Marketing API campaign-update endpoint. UNVERIFIED
 * against the live Meta API (no Marketing API credential is provisioned on
 * builder's production service), exactly like createAdTestCampaign.
 */
export async function activateAdTestCampaign(campaignId: string): Promise<AdTestCampaignResult> {
  if (!growthAdTestingCredentialConfigured()) return { ok: false, reason: 'credential_not_configured' }
  if (!campaignId?.trim()) return { ok: false, reason: 'campaign_id_required' }

  const accessToken = process.env.METAADS_ACCESS_TOKEN as string

  try {
    const res = await fetch(`${GRAPH_API_BASE}/${encodeURIComponent(campaignId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        status: 'ACTIVE',
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.error?.message || res.status).slice(0, 160) }
    }
    return { ok: true, campaignId, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

export interface AdTestInsights {
  ok: boolean
  clicks?: number
  cpcCents?: number
  reason?: string
}

/**
 * Fetch real clicks + cost-per-click for a campaign from Meta's Insights API
 * — display only, refreshed on demand, never used to compute billing
 * (billing is fixed server-side at purchase time). Never throws.
 *
 * Real contract: GET {GRAPH_API_BASE}/{campaignId}/insights?fields=clicks,cpc
 */
export async function fetchAdTestInsights(campaignId: string): Promise<AdTestInsights> {
  if (!growthAdTestingCredentialConfigured()) return { ok: false, reason: 'credential_not_configured' }
  if (!campaignId) return { ok: false, reason: 'campaign_id_required' }

  const accessToken = process.env.METAADS_ACCESS_TOKEN as string

  try {
    const url = `${GRAPH_API_BASE}/${encodeURIComponent(campaignId)}/insights?fields=clicks,cpc&access_token=${encodeURIComponent(accessToken)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, reason: String(data?.error?.message || res.status).slice(0, 160) }
    }
    // Meta returns { data: [ { clicks, cpc, ... } ] } — no rows yet (a fresh,
    // still-PAUSED campaign with zero delivery) is a real, honest zero-state,
    // not an error.
    const row = Array.isArray(data?.data) ? data.data[0] : null
    const clicks = row?.clicks ? Number(row.clicks) : 0
    const cpc = row?.cpc ? Number(row.cpc) : 0
    return { ok: true, clicks, cpcCents: Math.round(cpc * 100) }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
