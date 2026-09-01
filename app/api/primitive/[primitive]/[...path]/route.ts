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

export const runtime = 'nodejs'

const PRIMITIVE_BASES: Record<FounderScopedPrimitive, string> = {
  zerocommerce: process.env.ZEROCOMMERCE_API_URL || 'https://zerocommerce.ainative.studio/api/v1',
  zeropipeline: process.env.ZEROPIPELINE_API_URL || 'https://pipeline.ainative.studio/api/v1',
  agentflow: process.env.AGENTFLOW_API_URL || 'https://agentflow.ainative.studio/api/v1/build',
  zeroforms: process.env.ZEROFORMS_API_URL || 'https://zeroforms-production.up.railway.app/v1',
}

function isFounderScopedPrimitive(name: string): name is FounderScopedPrimitive {
  return name === 'zerocommerce' || name === 'zeropipeline' || name === 'agentflow' || name === 'zeroforms'
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
  const targetUrl = `${base}/${path.join('/')}${request.nextUrl.search}`

  let body: string | undefined
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.text().catch(() => undefined)
  }

  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'Content-Type': request.headers.get('content-type') || 'application/json',
      },
      body,
      signal: AbortSignal.timeout(20000),
    })
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
