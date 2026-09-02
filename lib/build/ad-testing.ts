/**
 * Growth module — automated ad-testing (#449, child of the 2026-09-01 product
 * call). Toby committed to surfacing a "Growth" section where paid founders
 * get an automated ad-testing layer to validate their product.
 *
 * SCOPE OF THIS PASS: the full vision includes builder acting as a reseller
 * marking up real ad spend for margin — that billing half needs a real
 * metered/usage-billing API on core that does not exist today (builder only
 * proxies fixed-price subscription checkout to core, per
 * app/api/build/checkout/route.ts; never holds a Stripe key directly). Filed
 * that gap as core#6835. This module ships the safe half: creating ONE real,
 * PAUSED Meta Ads test campaign a founder can review and manually launch —
 * never auto-activated, never any real spend from this code path. No billing
 * of any kind happens here.
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
