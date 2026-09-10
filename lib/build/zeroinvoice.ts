/**
 * ZeroInvoice OAuth connect client (#418, child of #414) — powers the
 * founder-facing "Connect ZeroInvoice" dashboard button, which sends the
 * founder's BROWSER through ZeroInvoice's own hosted OAuth 2.1 + PKCE flow
 * and its own account dashboard. This remains real and necessary: it is
 * how a founder links their AINative identity to ZeroInvoice's product on
 * ZeroInvoice's own side. ZeroInvoice's own real frontend
 * (frontend-nextjs/app/api/auth/ainative/callback/route.ts) fully owns that
 * callback — it exchanges the code, sets its OWN httpOnly cookies, and
 * redirects the browser to ITS OWN /dashboard. Builder never receives a
 * token, a callback, or any signal that this particular flow completed —
 * this client can only fetch the real authorize URL to send the founder to,
 * never confirm anything past that point.
 *
 * CORRECTION (2026-09-10, #638/#639): this doc previously claimed "no
 * headless/client-credentials alternative exists" for calling ZeroInvoice
 * AT ALL — that was wrong. Re-investigated against ZeroInvoice's real
 * backend source (deps.py::get_current_user falling through to
 * _try_ainative_token) and confirmed LIVE against production: ZeroInvoice's
 * actual business endpoints (invoices/clients/payments) accept a plain
 * AINative JWT directly via `Authorization: Bearer <jwt>` — the SAME
 * direct-JWT-bearer contract ZeroPipeline/ZeroCommerce/ZeroForms/AgentFlow/
 * ZeroCRM use. That path does NOT need this OAuth connect flow at all — see
 * app/api/primitive/[primitive]/[...path]/route.ts's `zeroinvoice` case and
 * lib/build/primitive-catalog.ts's ZeroInvoice RUNTIME_PROXIED_PRIMITIVES
 * entry, wired the same way provision/route.ts captures the credential for
 * the other founder-scoped primitives. This module's OAuth flow and that
 * runtime proxy are two DIFFERENT, both-real integration surfaces — this
 * one is the founder's own ZeroInvoice-hosted dashboard/account; the other
 * is what a generated app's runtime code calls.
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
