/**
 * ZeroPipeline provisioning client (#243, directive C).
 *
 * ZeroPipeline (the AINative CRM primitive) authenticates with an AINative **JWT
 * bearer** — the same identity the founder signs in with (verified against its
 * api-quickstart: login at api.ainative.studio → token → bearer on ZeroPipeline;
 * users/orgs are auto-provisioned from a valid token). It does NOT accept the
 * Instant DB api_key, so this is only usable when we have the founder's JWT (i.e.
 * a signed-in founder), which we then use to create their company's real pipeline.
 *
 * This is the "attempt to provision the primitive the card represents" path from
 * directive #1: for signed-in founders it creates a REAL ZeroPipeline pipeline; if
 * the call fails (auth/endpoint), we surface the failure so the card stays honestly
 * simulated and the tracking issue (AINative-Studio/ZeroPipeline) captures the gap.
 */

const ZP_BASE = process.env.ZEROPIPELINE_API_URL || 'https://pipeline.ainative.studio/api/v1'

export interface ZeroPipelineResult {
  ok: boolean
  pipelineId?: string
  reason?: string
  status?: number
}

/**
 * Look up an existing pipeline by its exact name (builder#721) — ZeroPipeline's
 * real backend does not support a server-side name filter on GET /pipelines
 * (confirmed live: a `?name=` query param is silently ignored, returning the
 * full unfiltered list), so this fetches the list and matches client-side.
 * Best-effort: any failure returns null rather than throwing, so a caller
 * falling back to this after a 409 degrades to the original honest failure
 * instead of a crash.
 */
async function findPipelineByName(jwt: string, name: string): Promise<string | null> {
  try {
    const res = await fetch(`${ZP_BASE}/pipelines`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const items: any[] = Array.isArray(data?.items) ? data.items : []
    const match = items.find((p) => p?.name === name && !p?.deleted_at)
    return match?.id ? String(match.id) : null
  } catch {
    return null
  }
}

/**
 * Create (idempotently) a default sales pipeline for a company on ZeroPipeline,
 * using the founder's JWT. Sends a real Idempotency-Key derived from the slug,
 * but ZeroPipeline's backend does NOT actually honor it as an idempotency key
 * (builder#721, confirmed live) — a repeat POST with the same pipeline name
 * returns a genuine 409 conflict_error, not the original 201's body. On that
 * specific conflict, falls back to looking the existing pipeline up by name
 * and treating it as a success (this IS what idempotency should have done),
 * rather than surfacing a failure for a pipeline that demonstrably already
 * exists and works. Any other failure (real auth/network error, or the
 * fallback lookup itself coming up empty) still fails honestly.
 */
export async function provisionPipeline(jwt: string, slug: string, companyName: string): Promise<ZeroPipelineResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  const pipelineName = `${companyName || slug} — Sales`
  try {
    const res = await fetch(`${ZP_BASE}/pipelines`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `builder-company:${slug}`,
      },
      body: JSON.stringify({
        name: pipelineName,
        stages: [
          { name: 'Lead', order_index: 0 },
          { name: 'Qualifying', order_index: 1 },
          { name: 'Proposal', order_index: 2 },
          { name: 'Won', order_index: 3 },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 409 && data?.error_code === 'conflict_error') {
        const existingId = await findPipelineByName(jwt, pipelineName)
        if (existingId) return { ok: true, pipelineId: existingId, status: res.status }
      }
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || res.status).slice(0, 160) }
    }
    return { ok: true, pipelineId: String(data?.id || data?.pipeline?.id || ''), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
