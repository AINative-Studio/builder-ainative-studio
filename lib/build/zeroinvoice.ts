/**
 * ZeroInvoice connect client (#418, child of #414).
 *
 * ZeroInvoice's real auth is a browser-redirect OAuth 2.1 + PKCE flow — NOT
 * a direct-JWT-bearer pattern like ZeroPipeline/ZeroCommerce/ZeroForms/
 * AgentFlow. Confirmed via direct source read
 * (AINative-Studio/ZeroInvoice's backend/app/api/auth.py::
 * ainative_oauth_authorize/ainative_oauth_callback): no headless/
 * client-credentials alternative exists — `provision/route.ts` only ever
 * has the founder's JWT server-side, never a browser, so this cannot be
 * auto-provisioned the way every other primitive in this cluster is.
 *
 * CRITICAL, real architectural difference from every other client in this
 * codebase: ZeroInvoice's own real frontend
 * (frontend-nextjs/app/api/auth/ainative/callback/route.ts, confirmed via
 * source) fully owns the OAuth callback — it exchanges the code, sets its
 * OWN httpOnly cookies, and redirects the browser to ITS OWN /dashboard.
 * Builder never receives a token, a callback, or any signal that the flow
 * completed. There is no ZeroInvoice endpoint that lets builder verify a
 * connection after the fact (checked exhaustively against the live
 * openapi.json — no webhook, no account-lookup-by-AINative-identity route
 * exists). This client can therefore only fetch the real authorize URL for
 * the founder to be sent to — it cannot confirm anything past that point,
 * and must never claim to.
 *
 * Real, confirmed contract:
 *   GET /api/auth/ainative/authorize
 *   → { auth_url: string, state: string }  (live-verified 2026-09-01)
 */

const ZI_BASE = process.env.ZEROINVOICE_API_URL || 'https://zeroinvoice.ainative.studio/api'

export interface ZeroInvoiceConnectResult {
  ok: boolean
  authUrl?: string
  reason?: string
  status?: number
}

/**
 * Fetch the real ZeroInvoice OAuth authorize URL a founder should be sent
 * to. Never throws — a failure (network, unexpected shape, or ZeroInvoice
 * itself reporting SSO isn't configured — see #418's source note on
 * AINATIVE_CLIENT_ID) is surfaced as a structured, honest result.
 */
export async function getZeroInvoiceAuthorizeUrl(): Promise<ZeroInvoiceConnectResult> {
  try {
    const res = await fetch(`${ZI_BASE}/auth/ainative/authorize`, {
      method: 'GET',
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.detail || data?.message || res.status).slice(0, 160) }
    }
    const authUrl = data?.auth_url
    if (typeof authUrl !== 'string' || !authUrl) {
      return { ok: false, reason: 'authorize_response_missing_auth_url' }
    }
    return { ok: true, authUrl, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
