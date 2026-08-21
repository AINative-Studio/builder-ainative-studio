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
 * Create (idempotently) a default sales pipeline for a company on ZeroPipeline,
 * using the founder's JWT. Idempotency-Key is derived from the slug so repeated
 * provisions don't create duplicate pipelines.
 */
export async function provisionPipeline(jwt: string, slug: string, companyName: string): Promise<ZeroPipelineResult> {
  if (!jwt) return { ok: false, reason: 'no_jwt' }
  try {
    const res = await fetch(`${ZP_BASE}/pipelines`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `builder-company:${slug}`,
      },
      body: JSON.stringify({
        name: `${companyName || slug} — Sales`,
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
      return { ok: false, status: res.status, reason: String(data?.message || data?.detail || res.status).slice(0, 160) }
    }
    return { ok: true, pipelineId: String(data?.id || data?.pipeline?.id || ''), status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
