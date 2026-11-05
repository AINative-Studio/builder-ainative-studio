/**
 * POST /agentic_commerce/ap2/verify — AP2 (Agent Payments Protocol)
 * mandate verification (#1840, previously blocked transitively on #1838/
 * UCP — unblocked now that UCP/ACP are real on the Builder side too).
 *
 * Pure verification, not a money-moving call — core's real
 * POST /agentic_commerce/ap2/verify (src/backend/app/api/v1/endpoints/
 * ap2_verify.py) does real server-side SD-JWT verification against a
 * per-issuer key registry, with no signature/idempotency contract of its
 * own (unlike ACP's checkout endpoints). Straight passthrough forward —
 * no signing needed, no founder credential needed, since this never
 * identifies a Builder company at all; it only validates a mandate JWT's
 * own claims against core's issuer-key registry.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const CORE_BASE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'
const UPSTREAM_PATH = '/agentic_commerce/ap2/verify'

export async function POST(request: NextRequest) {
  const body = await request.text().catch(() => '')

  try {
    const res = await fetch(`${CORE_BASE}${UPSTREAM_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text().catch(() => '')
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json' },
    })
  } catch {
    return NextResponse.json({ error: 'ap2_upstream_unreachable' }, { status: 502 })
  }
}
