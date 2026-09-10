/**
 * Content Workflow client (#644 gap-analysis follow-up).
 *
 * UNLIKE the 10 founder-scoped primitives (ZeroPipeline, ZeroCommerce,
 * ZeroForms, AgentFlow, ZeroCRM, ZeroVoice, ZeroInvoice, ServiceOS, Live
 * Streaming, Social Graph — all direct-JWT-bearer, one resource per owner
 * user), Content Workflow's real auth is `X-API-Key: sk_...` — confirmed
 * live against production (docs.ainative.studio/docs/api/content-workflow):
 * a plain GET/POST against https://api.ainative.studio/api/v1/public/
 * content/calendar with Builder's own service-level AINATIVE_API_KEY
 * (the SAME key already used for ZeroDB REST calls throughout this
 * codebase) returned real 200/201s — no per-founder credential needed at
 * all, unlike the JWT-bearer group.
 *
 * The other real wrinkle: every calendar entry requires a `twin_id` (an AI
 * persona/"twin" — name, voice, style tags, persona prompt) that a
 * generated app has no way to know or manage on its own. Confirmed live:
 *   POST /twins  { name, voice_id, style_tags, persona_prompt } -> 201, real id
 *   GET  /twins/{id} -> 200, real twin
 *   DELETE /twins/{id} -> 204
 * One twin is auto-provisioned per company (lazily, on first real proxy
 * call — see the runtime proxy route's contentworkflow case) and its id
 * persisted on the app-registry entry, so generated code never has to
 * create or reference a twin_id itself — the proxy injects it, mirroring
 * how the ZeroCRM case already injects org_id server-side.
 */

const CW_BASE = process.env.CONTENT_WORKFLOW_API_URL || 'https://api.ainative.studio/api/v1/public'

export interface ContentWorkflowTwinResult {
  ok: boolean
  twinId?: string
  reason?: string
  status?: number
}

/**
 * Create a default AI twin/persona for a company, keyed loosely to its
 * brand name. Never throws — a failure is surfaced as a structured, honest
 * result. Idempotency is the CALLER's job (app-registry stores the twinId
 * once created; this function is only ever invoked when none exists yet).
 */
export async function createDefaultTwin(companyName: string): Promise<ContentWorkflowTwinResult> {
  try {
    const res = await fetch(`${CW_BASE}/twins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.AINATIVE_API_KEY || '' },
      body: JSON.stringify({
        name: `${companyName || 'Company'} Voice`,
        voice_id: 'default',
        style_tags: ['professional', 'friendly'],
        persona_prompt: `The authentic brand voice for ${companyName || 'this company'} — clear, helpful, on-brand social content.`,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, reason: String(data?.detail || data?.message || res.status).slice(0, 160) }
    }
    const twinId = data?.id
    if (typeof twinId !== 'string' || !twinId) {
      return { ok: false, reason: 'twin_response_missing_id' }
    }
    return { ok: true, twinId, status: res.status }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 160) }
  }
}
