/**
 * ZeroERP provisioning client (#439, child of #414/#422).
 *
 * ZeroERP's real onboarding contract is a dedicated, PUBLIC (no auth)
 * single-shot endpoint — confirmed via source
 * (AINative-Studio/ZeroERP's src/routes/onboarding.routes.ts, which
 * documents `POST /api/v1/onboarding/tenants` with `security: []` and the
 * comment "no authentication — the wizard is literally the very first thing
 * a new tenant hits"). Unlike ZeroPipeline/ZeroCommerce/ZeroForms/AgentFlow,
 * this call never needs the founder's JWT, so it can run unconditionally
 * (same shape as OpenCapStack's provisionCapTable).
 *
 * Real, confirmed contract:
 *   POST /api/v1/onboarding/tenants
 *   Body: { email, org_name, org_slug?, admin_first_name?, admin_last_name?,
 *           invite_ttl_hours? }
 *   → 201 (or 200 if already provisioned), idempotent on (email, org_slug):
 *     { tenant: {org_id, org_name, org_slug}, chart_of_accounts, fiscal_year,
 *       admin_invite: { invite_token, email, expires_at },
 *       already_provisioned }
 *
 * IMPORTANT, confirmed via source
 * (src/services/onboarding.service.ts::issueAdminInvite): the returned
 * admin_invite.invite_token is a RAW, UNSENT token — no email is actually
 * dispatched (the OpenAPI doc's "admin invite emailed" claim does not match
 * the real implementation), and a repo-wide route search found NO endpoint
 * anywhere that redeems an invite by token. There is currently no correct
 * accept-invite URL to construct or hand the founder — filed as
 * AINative-Studio/ZeroERP#1094. This client therefore surfaces the raw
 * token honestly as `inviteToken` (not a fabricated `inviteUrl`) so the
 * caller never claims a working link exists until #1094 is resolved.
 */

const ZE_BASE = process.env.ZEROERP_API_URL || 'https://zeroerp-production.up.railway.app/api/v1'

export interface ZeroERPResult {
  ok: boolean
  orgId?: string
  orgSlug?: string
  inviteToken?: string
  inviteExpiresAt?: string
  alreadyProvisioned?: boolean
  reason?: string
  status?: number
}

/**
 * Provision (idempotently) a ZeroERP tenant for a company. Uses the
 * founder's own email as the admin invite recipient. Never throws — a
 * failure (network, unexpected shape, or ZeroERP itself rejecting the
 * request) is surfaced as a structured, honest result. Idempotency is
 * handled entirely by ZeroERP's own endpoint (keyed on email + org_slug,
 * confirmed via source) — no separate existence-check call is needed.
 */
export async function provisionZeroERPTenant(
  email: string,
  slug: string,
  orgName: string,
): Promise<ZeroERPResult> {
  if (!email) return { ok: false, reason: 'no_email' }
  try {
    const res = await fetch(`${ZE_BASE}/onboarding/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        org_name: orgName || slug,
        org_slug: slug,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: String(data?.message || data?.detail || res.status).slice(0, 160),
      }
    }
    const body = data?.data ?? data
    return {
      ok: true,
      status: res.status,
      orgId: body?.tenant?.org_id,
      orgSlug: body?.tenant?.org_slug,
      inviteToken: body?.admin_invite?.invite_token,
      inviteExpiresAt: body?.admin_invite?.expires_at,
      alreadyProvisioned: Boolean(body?.already_provisioned),
    }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
