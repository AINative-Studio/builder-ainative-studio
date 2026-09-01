/**
 * AgentFlow provisioning client (#419, child of #414).
 *
 * AgentFlow now accepts the same unified AINative JWT bearer the founder
 * signs in with — confirmed via its real source (AINative-Studio/AgentFlow
 * PR #74, `get_current_user_by_jwt()` in
 * `src/backend/base/agentflow/services/auth/utils.py`): it tries its own
 * local-secret JWT decode first, and on failure falls back to verifying the
 * token against AINative core's key-verification endpoint, auto-provisioning
 * a local user on first use. Same direct-bearer pattern already proven for
 * ZeroPipeline/ZeroCommerce/ZeroForms — no service-account workaround needed
 * (the credential-shape mismatch #419 originally flagged was fixed upstream
 * in AgentFlow itself, not worked around in builder).
 *
 * Real, confirmed contract (see AgentFlow's live openapi.json):
 *   POST /api/v1/projects/
 *   body: { name } — "project" is AgentFlow's user-facing name for its
 *   underlying Folder model; a default project is the natural per-company
 *   provisioning unit, the same role ZeroForms' default form / ZeroCommerce's
 *   default store play for their primitives.
 *
 * No Idempotency-Key header is documented for this endpoint. A repeat
 * provisioning call for an already-provisioned company will create a second
 * project rather than erroring or returning the existing one — this client
 * does not attempt its own dedup; callers that need idempotency should check
 * app-registry state before calling, the same way provision/route.ts already
 * short-circuits repeat calls at the top level.
 */

const AF_BASE = process.env.AGENTFLOW_API_URL || 'https://agentflow.ainative.studio/api/v1'

export interface AgentFlowResult {
  ok: boolean
  projectId?: string
  reason?: string
  status?: number
}

/**
 * Create a company's default AgentFlow project using the founder's JWT.
 * Never throws — a failure (auth, validation, or a business rule) is
 * surfaced as a structured, honest result so the caller can leave the
 * AgentFlow card simulated rather than fabricate success.
 */
export async function provisionProject(jwt: string, slug: string, companyName: string): Promise<AgentFlowResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  try {
    const res = await fetch(`${AF_BASE}/projects/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: companyName || slug,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.detail || data?.message || res.status).slice(0, 160) }
    }
    return { ok: true, projectId: String(data?.id || ''), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
