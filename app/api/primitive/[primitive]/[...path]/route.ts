/**
 * Founder-scoped primitive proxy (#443) — the runtime-callable path for
 * primitives whose provisioning is scoped to the founder's own AINative
 * identity ("one resource per owner user": ZeroCommerce confirmed via #417,
 * ZeroPipeline/AgentFlow/ZeroForms share the shape). Unlike /api/db (backed
 * by a durable service key builder holds forever), these have no separate
 * service credential — only a copy of the founder's own tokens, captured at
 * provision time and kept refreshed server-side (lib/build/primitive-credentials.ts).
 *
 * GET/POST/PUT/DELETE /api/primitive/{primitive}/{...path}
 *   forwards to {primitive's real apiBase}/{path} with the resolved founder
 *   Bearer token attached server-side. Generic passthrough (not a per-
 *   endpoint reimplementation) — this session verified ZeroCommerce's
 *   onboarding contract but not its full runtime product/order surface, so
 *   the proxy forwards whatever real path the generated app calls rather
 *   than guessing at unverified shapes.
 *
 * AUTH (mirrors /api/db/[table]/route.ts's resolveProject exactly):
 *  - A DEPLOYED company's own Railway service reads COMPANY_SLUG directly
 *    from process.env — Railway-injected, not client-forgeable, so no token
 *    is needed there (same trust boundary /api/db already uses).
 *  - The shared PREVIEW iframe (multiple companies' code, one process) has
 *    no env-var binding, so it needs the signed per-app token instead
 *    (Authorization: Bearer <token>, x-ainative-primitive-token header, or
 *    ?t= query — same header set /api/db accepts).
 *  A present-but-invalid token, or an absent token with no COMPANY_SLUG env
 *  var either, FAILS CLOSED (401) — never a silent fallback to any shared
 *  identity, since that would let one company act as another's founder.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyPrimitiveProxyToken } from '@/lib/build/primitive-proxy-token'
import { resolveFounderCredential, type FounderScopedPrimitive } from '@/lib/build/primitive-credentials'
import { resolveApp, setAppContentWorkflowTwinId } from '@/lib/build/app-registry'
import { createDefaultTwin } from '@/lib/build/content-workflow'

export const runtime = 'nodejs'

// #644 gap-analysis follow-up — Content Workflow's real auth is X-API-Key,
// NOT the direct-JWT-bearer contract every founder-scoped primitive above
// uses (confirmed live: Builder's own service-level AINATIVE_API_KEY —
// the same key already used for ZeroDB REST calls — works directly against
// https://api.ainative.studio/api/v1/public/content/calendar, no per-
// founder credential capture needed at all). Every calendar entry also
// requires a twin_id (an AI persona) the generated app has no way to know;
// one is auto-provisioned per company on first real call and cached on the
// app-registry entry (lib/build/content-workflow.ts's doc has the full
// story). Handled as an early, separate branch in forward() rather than
// squeezed into the founder-credential flow, since the auth model and
// provisioning shape are both genuinely different.
const CONTENT_WORKFLOW_BASE = process.env.CONTENT_WORKFLOW_API_URL || 'https://api.ainative.studio/api/v1/public'

async function forwardContentWorkflow(request: NextRequest, path: string[], slug: string): Promise<NextResponse> {
  const apiKey = process.env.AINATIVE_API_KEY || ''
  if (!apiKey) {
    return NextResponse.json({ error: 'primitive_unavailable', reason: 'service_key_not_configured' }, { status: 502 })
  }

  const app = await resolveApp(slug).catch(() => null)
  let twinId = app?.contentWorkflowTwinId

  // Lazily auto-provision ONE twin per company on first real call — a
  // generated app's own code never creates or manages twin_id itself.
  if (!twinId) {
    const created = await createDefaultTwin(app?.name || slug)
    if (!created.ok || !created.twinId) {
      return NextResponse.json(
        { error: 'primitive_unavailable', reason: created.reason || 'twin_provisioning_failed' },
        { status: 502 },
      )
    }
    twinId = created.twinId
    await setAppContentWorkflowTwinId(slug, twinId).catch(() => {})
  }

  let body: string | undefined
  let parsedBody: any
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text().catch(() => undefined)
    if (body) {
      try { parsedBody = JSON.parse(body) } catch { parsedBody = undefined }
    }
  }
  // Inject twin_id server-side for calendar writes — never override a
  // caller-supplied twin_id if one is already present (mirrors the
  // ZeroCRM org_id injection pattern below).
  if (parsedBody && typeof parsedBody === 'object' && !parsedBody.twin_id) {
    parsedBody.twin_id = twinId
    body = JSON.stringify(parsedBody)
  }

  const targetUrl = `${CONTENT_WORKFLOW_BASE}/${path.join('/')}${request.nextUrl.search}`
  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': request.headers.get('content-type') || 'application/json',
      },
      body,
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text().catch(() => '')
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'primitive_unreachable' }, { status: 502 })
  }
}

const PRIMITIVE_BASES: Record<FounderScopedPrimitive, string> = {
  zerocommerce: process.env.ZEROCOMMERCE_API_URL || 'https://zerocommerce.ainative.studio/api/v1',
  zeropipeline: process.env.ZEROPIPELINE_API_URL || 'https://pipeline.ainative.studio/api/v1',
  // Real base confirmed via AgentFlow's live openapi.json (/api/v1/projects/,
  // no /build segment — the PR that first added this entry had it wrong;
  // matches lib/build/agentflow.ts's own AF_BASE, which was already correct).
  agentflow: process.env.AGENTFLOW_API_URL || 'https://agentflow.ainative.studio/api/v1',
  zeroforms: process.env.ZEROFORMS_API_URL || 'https://zeroforms-production.up.railway.app/v1',
  // #414/#655 — ZeroCRM auto-provisions the Org+User on first authenticated
  // request (app/api/deps.py::_get_or_create_user_from_ainative_identity),
  // no separate provisioning call exists or is needed — live-verified via
  // GET /api/v1/deals?org_id=<real AINative organization_uuid> → 200 with a
  // freshly-created org, idempotent on repeat calls.
  zerocrm: process.env.ZEROCRM_API_URL || 'https://zerocrm-production.up.railway.app/api/v1',
  // #522 — ZeroVoice's per-company account is provisioned at the explicit
  // /api/build/zerovoice action (#415), same founder-JWT-bearer credential
  // shape as the 5 above. Real base confirmed via live openapi.json
  // (api.ainative.studio does NOT proxy ZeroVoice at all — 404s there).
  zerovoice: process.env.ZEROVOICE_API_URL || 'https://zerovoice-production.up.railway.app/api/v1',
  // #638/#639 — ZeroInvoice was long believed to have NO direct-JWT-bearer
  // path (lib/build/zeroinvoice.ts's original doc comment: "no headless/
  // client-credentials alternative exists" — its OAuth 2.1+PKCE browser flow
  // is real, but ZeroInvoice's own frontend fully owns that callback and
  // never returns a token to builder). Re-investigated 2026-09-10 against
  // ZeroInvoice's actual backend source (deps.py::get_current_user falls
  // through to _try_ainative_token, which accepts a plain AINative JWT via
  // GET /v1/public/auth/me — the SAME contract the other 6 primitives use)
  // and CONFIRMED LIVE against production: a real AINative JWT sent as
  // `Authorization: Bearer <jwt>` to https://zeroinvoice.ainative.studio/api/
  // invoices/ returned a genuine 200 with a real invoice list, and a real
  // POST created a real invoice (INV-2026-0001, real id/totals, cleaned up
  // after verification). The prior "impossible" finding was wrong — this IS
  // the same founder-scoped, direct-JWT-bearer shape as the other 6.
  zeroinvoice: process.env.ZEROINVOICE_API_URL || 'https://zeroinvoice.ainative.studio/api',
  // #642 — ServiceOS (helpdesk) was flagged in a systematic gap sweep
  // (2026-09-10, following #638/#639's ZeroInvoice fix) as having real,
  // common founder triggers (support/helpdesk/tickets/customer service) but
  // no runtime proxy at all. Confirmed LIVE against production, per docs.
  // ainative.studio/docs/business-ops/serviceos: GET /api/tickets and POST
  // /api/tickets both work with a plain AINative JWT (a real ticket was
  // created — row_id eff5ef13-93cf-48db-9426-ea973032e1b0 — and appeared in
  // a subsequent list). Same founder-scoped direct-JWT-bearer shape as the
  // other 7. Generic passthrough here has only verified GET/POST; PATCH
  // /tickets/:id is real and documented (confirmed via docs) but this
  // session hit an org-scoping 403 attempting to close its own test ticket
  // — not yet independently re-verified, so treat PATCH/DELETE as
  // documented-but-unconfirmed until a real update/close is exercised live.
  serviceos: process.env.SERVICEOS_API_URL || 'https://helpdesk.ainative.studio/api',
  // #644 gap-analysis follow-up — Live Streaming was flagged as a confirmed
  // real gap: real, common founder triggers (stream/live/video/broadcast),
  // real apiBase, but no runtime proxy at all. Confirmed LIVE against
  // production per docs.ainative.studio/docs/live-streaming/streams:
  // GET https://api.ainative.studio/api/v1/streams/ (trailing slash matters
  // — the real backend serves under it) 200'd with real production stream
  // data (28 real streams). Same founder-scoped direct-JWT-bearer shape as
  // the other 8. Deliberately did NOT create a live test stream against this
  // host during verification — the listed data is real production content,
  // not a sandbox.
  livestreaming: process.env.LIVE_STREAMING_API_URL || 'https://api.ainative.studio',
  // #644 gap-analysis follow-up — Social Graph was flagged as a confirmed
  // real gap: real, common founder triggers (social/followers/friends/
  // network), real apiBase, but no runtime proxy at all. Confirmed LIVE
  // against production per docs.ainative.studio/docs/community/social-graph:
  // GET /api/v1/social/{user_id}/followers 200'd with a real empty-list
  // response. Same founder-scoped direct-JWT-bearer shape as the other 9 —
  // NOTE the {user_id} path segment is the AUTHENTICATED user's own id
  // (resolved server-side by Social Graph from the JWT itself for write
  // ops like follow/unfollow; for read ops like followers/following the
  // caller supplies whichever user_id they want to look up, which may be
  // a DIFFERENT user than the founder — this is a public social graph, not
  // founder-private data like the other 9 primitives).
  socialgraph: process.env.SOCIAL_GRAPH_API_URL || 'https://api.ainative.studio',
}

function isFounderScopedPrimitive(name: string): name is FounderScopedPrimitive {
  return name === 'zerocommerce' || name === 'zeropipeline' || name === 'agentflow' || name === 'zeroforms' || name === 'zerocrm' || name === 'zerovoice' || name === 'zeroinvoice' || name === 'serviceos' || name === 'livestreaming' || name === 'socialgraph'
}

/** Resolve which company's founder credential this request should use.
 *  Deployed service (env var) takes precedence — it's the stronger, non-
 *  forgeable binding; the signed token is the fallback for the shared
 *  preview iframe. Returns null on anything invalid/absent (fail closed). */
function resolveSlug(request: NextRequest): string | null {
  const envSlug = process.env.COMPANY_SLUG
  if (envSlug) return envSlug

  const auth = request.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const token =
    bearer ||
    request.headers.get('x-ainative-primitive-token') ||
    request.nextUrl.searchParams.get('t') ||
    ''
  if (!token) return null
  const payload = verifyPrimitiveProxyToken(token)
  return payload?.slug || null
}

const UNAUTHORIZED = (reason: string) =>
  NextResponse.json({ error: 'unauthorized', reason }, { status: 401 })

async function forward(
  request: NextRequest,
  params: Promise<{ primitive: string; path: string[] }>,
): Promise<NextResponse> {
  const { primitive: primitiveName, path } = await params

  // Content Workflow: same auth/routing (COMPANY_SLUG env or signed token)
  // as every other primitive below, but a completely different credential
  // model (service key + auto-provisioned twin, not a founder JWT) — see
  // forwardContentWorkflow's doc comment above.
  if (primitiveName === 'contentworkflow') {
    const slug = resolveSlug(request)
    if (!slug) return UNAUTHORIZED('missing_or_invalid_token')
    return forwardContentWorkflow(request, path, slug)
  }

  if (!isFounderScopedPrimitive(primitiveName)) {
    return NextResponse.json({ error: 'unknown_primitive' }, { status: 404 })
  }

  const slug = resolveSlug(request)
  if (!slug) return UNAUTHORIZED('missing_or_invalid_token')

  const credential = await resolveFounderCredential(slug, primitiveName)
  if (!credential.ok || !credential.accessToken) {
    // Honest, structured failure the generated app's code can branch on —
    // never a crash, never a silently-empty success.
    return NextResponse.json(
      { error: 'primitive_unavailable', reason: credential.reason || 'not_provisioned' },
      { status: 502 },
    )
  }

  const base = PRIMITIVE_BASES[primitiveName]
  // #414 — ZeroCRM's get-or-create org resolution requires an explicit
  // ?org_id= query param (unlike the other 4 founder-scoped primitives,
  // which resolve org scoping server-side from the JWT alone — confirmed via
  // direct decode that AINative's JWT carries no org claim at all). The
  // generated app's own code has no way to know the founder's real
  // organization_uuid, so the proxy injects it here from the credential
  // captured at provision time, rather than expecting the caller to supply
  // it. Never overrides a caller-supplied org_id if one is already present.
  const search = new URLSearchParams(request.nextUrl.search)
  if (primitiveName === 'zerocrm' && credential.organizationId && !search.has('org_id')) {
    search.set('org_id', credential.organizationId)
  }
  // #638/#639 — ZeroInvoice's real backend 307-redirects any collection-level
  // path (e.g. /invoices, /clients) that lacks a trailing slash (confirmed
  // live). A POST/PUT/DELETE following that redirect risks the body/method
  // being dropped or the Authorization header being stripped across the
  // redirect — a real failure mode a generated app's own fetch() would hit
  // silently. Only append when the LAST segment has no dot (a resource id
  // like `inv_20260910_...` needs no trailing slash, and this must never
  // touch the other 6 primitives' real, already-correct path shapes).
  const joinedPath = path.join('/')
  const needsTrailingSlash =
    primitiveName === 'zeroinvoice' && path.length === 1 && !joinedPath.endsWith('/')
  const forwardedPath = needsTrailingSlash ? `${joinedPath}/` : joinedPath
  const searchString = search.toString()
  const targetUrl = `${base}/${forwardedPath}${searchString ? `?${searchString}` : ''}`

  let body: string | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text().catch(() => undefined)
  }

  const callPrimitive = (accessToken: string) =>
    fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': request.headers.get('content-type') || 'application/json',
      },
      body,
      signal: AbortSignal.timeout(20000),
    })

  try {
    let res = await callPrimitive(credential.accessToken)
    // #443/#664 follow-up: reactive backstop. Confirmed live (2026-09-12) that
    // EVERY stored founder-scoped credential across every real company has no
    // expiresAt/refresh token at all (the getToken()-based capture path was
    // silently broken — see provision/route.ts's fix), so the primitive's OWN
    // 401 is often the FIRST real signal the token has expired — the proactive
    // check above never had anything to act on. One forced-refresh retry: if
    // the real primitive itself rejects the credential, try a real refresh
    // (skips the proactive expiry estimate entirely) and retry ONCE with
    // whatever token comes back. If the refresh yields the identical token
    // (no refresh token was ever captured — the 25 already-broken credentials
    // from before this fix), the retry legitimately 401s again and we stop —
    // never loop, never fabricate a success.
    if (res.status === 401) {
      const refreshed = await resolveFounderCredential(slug, primitiveName, { forceRefresh: true })
      if (refreshed.ok && refreshed.accessToken && refreshed.accessToken !== credential.accessToken) {
        res = await callPrimitive(refreshed.accessToken)
      }
    }
    const text = await res.text().catch(() => '')
    // Forward the real primitive's response verbatim (status + body) — the
    // credential itself is never included in any response we send back.
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'primitive_unreachable' }, { status: 502 })
  }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ primitive: string; path: string[] }> }) {
  return forward(request, ctx.params)
}
export async function POST(request: NextRequest, ctx: { params: Promise<{ primitive: string; path: string[] }> }) {
  return forward(request, ctx.params)
}
export async function PUT(request: NextRequest, ctx: { params: Promise<{ primitive: string; path: string[] }> }) {
  return forward(request, ctx.params)
}
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ primitive: string; path: string[] }> }) {
  return forward(request, ctx.params)
}
