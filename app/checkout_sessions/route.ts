/**
 * POST /checkout_sessions — ACP (Agentic Commerce Protocol) checkout,
 * execution half of #1838.
 *
 * This genuinely creates a real Stripe checkout session for a real
 * AINative subscription plan (Hobbyist/Starter/Pro/Business/Enterprise/
 * Cody — the same plans core's real plan_catalog_service.STRIPE_PRICE_IDS
 * knows about). It does NOT let a founder's generated storefront sell its
 * own products through ACP — core has no merchant/caller-scoping concept
 * for that yet (confirmed: core's own acp_signature.py docstring says a
 * per-caller secret registry is "a natural follow-up... tracked as a
 * known gap," not something that exists today). An agent buying "AINative
 * Pro" via builder.ainative.studio really is subscribing to the same real
 * plan it would get calling api.ainative.studio directly — Builder is
 * exposing core's real capability under a second hostname, the same
 * relationship it already has with every other primitive.
 *
 * Forwards the request to core's live POST /checkout_sessions
 * (src/backend/app/api/v1/endpoints/acp_checkout.py), signing it with the
 * SAME HMAC-SHA256 scheme core's own acp_signature.verify_acp_signature
 * requires (see lib/build/acp-signature.ts). Forwards the caller's
 * Idempotency-Key verbatim if present — core's own idempotency_service
 * handles replay, Builder doesn't need its own.
 *
 * This is a genuine real-money path (real stripe.checkout.Session.create
 * on core's side). Never mocked/stubbed in a way that could silently
 * swallow a failure as a false success — any upstream error is forwarded
 * with its real status and body, not translated into a fabricated 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { signAcpRequest, isAcpSigningConfigured } from '@/lib/build/acp-signature'

export const runtime = 'nodejs'

const CORE_BASE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
const UPSTREAM_PATH = '/checkout_sessions'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } })
}

export async function POST(request: NextRequest) {
  if (!isAcpSigningConfigured()) {
    return NextResponse.json(
      { error: 'acp_not_configured', reason: 'ACP_SIGNING_SECRET is not set' },
      { status: 502 },
    )
  }

  const body = await request.text().catch(() => '')
  const { signature, timestamp } = signAcpRequest({
    method: 'POST',
    path: UPSTREAM_PATH,
    timestampSeconds: Math.floor(Date.now() / 1000),
    body,
  })

  const idempotencyKey = request.headers.get('idempotency-key')

  try {
    const res = await fetch(`${CORE_BASE}${UPSTREAM_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Signature: signature,
        Timestamp: timestamp,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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
    return NextResponse.json({ error: 'acp_upstream_unreachable' }, { status: 502 })
  }
}
