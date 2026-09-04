/**
 * OpenCapStack provisioning client (#427, child of #414/#422).
 *
 * Unlike ZeroPipeline/ZeroCommerce (direct reuse of the founder's own AINative
 * JWT), OpenCapStack has no AINative-federated auth — it needs its own login.
 * Builder authenticates as a dedicated SERVICE ACCOUNT
 * (OPENCAPSTACK_SERVICE_EMAIL/OPENCAPSTACK_SERVICE_PASSWORD, a real account
 * created for this purpose — see #422) rather than the founder's identity, the
 * same shape as ZeroInvoice/ZeroForms/AgentFlow once their own blockers clear.
 *
 * Real, confirmed contract (see #422/#427):
 *   POST /api/v1/auth/login          {email, password} -> {accessToken, ...}
 *   POST /api/v1/companies           Authorization: Bearer <accessToken>
 *                                    {name, companyType} -> 201 {companyId, ...}
 *   (controllers/Company.js, Open-Cap-Stack/opencapstack — accepts either the
 *   frontend field names used here or the backend CompanyName/CompanyType;
 *   companyType maps through a real enum: 'Delaware C-Corp'/'LLC'/'Other' all
 *   resolve to 'startup'.)
 *
 * The service-account token is short-lived and not cached across requests
 * (provisioning is a rare, one-time-per-company event, not a hot path) — each
 * call logs in fresh. Never throws — a failure at either step is surfaced as a
 * structured, honest result so the caller can leave the cap-table card
 * simulated rather than fabricate success.
 */

const OCS_BASE = process.env.OPENCAPSTACK_API_URL || 'https://api.opencapstack.com/api/v1'

export interface OpenCapStackResult {
  ok: boolean
  companyId?: string
  reason?: string
  status?: number
}

/**
 * Exported (#503) so the runtime proxy (app/api/opencapstack/[action]/route.ts)
 * can log in fresh per-request and forward a generated app's call, the same
 * "no caching, short-lived token" contract provisionCapTable already uses —
 * not a separate auth implementation.
 */
export async function loginServiceAccount(): Promise<{ ok: boolean; token?: string; reason?: string; status?: number }> {
  const email = process.env.OPENCAPSTACK_SERVICE_EMAIL || ''
  const password = process.env.OPENCAPSTACK_SERVICE_PASSWORD || ''
  if (!email || !password) return { ok: false, reason: 'no_service_account' }
  try {
    const res = await fetch(`${OCS_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.accessToken) {
      return { ok: false, status: res.status, reason: String(data?.message || res.status).slice(0, 160) }
    }
    return { ok: true, token: String(data.accessToken) }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}

/**
 * Create a company's OpenCapStack cap table record using the stored service
 * account. `companyType` follows OpenCapStack's own frontend vocabulary
 * ('Delaware C-Corp' | 'LLC' | 'Other') — all map to its backend 'startup'
 * enum value; there is no company-specific choice to surface to the founder
 * yet, so this always sends 'Delaware C-Corp' (the common default for a US
 * startup) until a real entity-type input exists in the build flow.
 */
export async function provisionCapTable(companyName: string): Promise<OpenCapStackResult> {
  const login = await loginServiceAccount()
  if (!login.ok || !login.token) {
    return { ok: false, reason: login.reason || 'service_account_login_failed', status: login.status }
  }
  try {
    const res = await fetch(`${OCS_BASE}/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${login.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: companyName,
        companyType: 'Delaware C-Corp',
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.message || res.status).slice(0, 160) }
    }
    return { ok: true, companyId: String(data?.companyId || ''), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
