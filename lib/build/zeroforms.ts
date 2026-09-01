/**
 * ZeroForms provisioning client (#421, child of #414).
 *
 * ZeroForms authenticates with the same AINative JWT bearer the founder signs
 * in with — confirmed via its real source (`backend/app/security/dependencies.py`
 * ::get_current_user), the same direct-bearer pattern already proven for
 * ZeroPipeline/ZeroCommerce. The "AINative API key" path there validates the
 * token against core's own verify endpoint and maps the identity onto a local
 * User with `is_verified=True` set explicitly — so `require_verified` (which
 * gates form creation) is satisfied on first use, no separate ZeroForms
 * signup/dashboard step needed.
 *
 * Real, confirmed contract (see #421):
 *   POST /v1/forms
 *   body: { name, type: 'card'|'crm'|'ai'|'pdf', config?, branding? }
 *   201 on success; free-tier plan limit is 3 forms (irrelevant for a single
 *   provisioning call).
 *
 * No Idempotency-Key header is documented for this endpoint (unlike
 * ZeroPipeline's /pipelines). A repeat provisioning call for an
 * already-provisioned company will create a second form rather than erroring
 * or returning the existing one — this client does not attempt its own
 * dedup; callers that need idempotency should check
 * app-registry state before calling, the same way provision/route.ts already
 * short-circuits repeat calls at the top level.
 */

const ZF_BASE = process.env.ZEROFORMS_API_URL || 'https://zeroforms-production.up.railway.app/v1'

export interface ZeroFormsResult {
  ok: boolean
  formId?: string
  reason?: string
  status?: number
}

/**
 * Create a company's default ZeroForms form using the founder's JWT. Never
 * throws — a failure (auth, validation, or plan-limit) is surfaced as a
 * structured, honest result so the caller can leave the Forms card simulated
 * rather than fabricate success.
 */
export async function provisionForm(jwt: string, slug: string, companyName: string): Promise<ZeroFormsResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  try {
    const res = await fetch(`${ZF_BASE}/forms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `${companyName || slug} — Intake`,
        type: 'card',
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || res.status).slice(0, 160) }
    }
    return { ok: true, formId: String(data?.id || ''), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
