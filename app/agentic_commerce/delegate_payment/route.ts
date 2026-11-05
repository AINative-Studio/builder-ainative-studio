/**
 * POST /agentic_commerce/delegate_payment — ACP delegate-payment,
 * execution half of #1838. Same real-money/signing considerations as
 * app/checkout_sessions/route.ts — see that file's doc comment for the
 * full rationale (core's real plans only, no founder-storefront merchant
 * scoping, Builder forwarding to core exactly like every other primitive).
 *
 * Vaults an already-tokenized payment method (a real Stripe `pm_...` id)
 * into a real, constrained Stripe SetupIntent on core's side
 * (src/backend/app/api/v1/endpoints/acp_delegate_payment.py). Builder
 * never sees or handles a raw card number — the caller must already have
 * tokenized it client-side (Stripe.js/Elements), same PCI boundary core
 * itself enforces.
 */

import { NextRequest, NextResponse } from 'next/server'
import { signAcpRequest, isAcpSigningConfigured } from '@/lib/build/acp-signature'

export const runtime = 'nodejs'

const CORE_BASE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
const UPSTREAM_PATH = '/agentic_commerce/delegate_payment'

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
