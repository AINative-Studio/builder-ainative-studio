/**
 * POST /api/build/subscription/portal (#253) — open the Stripe customer billing
 * portal for a signed-in paying founder so they can see/change/cancel their plan.
 *
 * Proxies core `POST /api/v1/billing/portal` (JWT-auth) with the founder's token
 * and returns the portal `url`. This is what the Live/Account "Manage plan"
 * affordances link to — a real self-serve billing surface, not a dead route.
 *
 * Anonymous / no session → 401. Best-effort return_url so the portal sends the
 * founder back to the Builder after they finish.
 *
 * Returns: { url } | { error }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const token = (session as any)?.accessToken as string | undefined
  if (!token) return Response.json({ error: 'not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  // Where Stripe returns the founder after they finish in the portal. Default to
  // the my-companies index; a caller may pass a company-specific return.
  const returnUrl = String(body?.returnUrl || `${APP}/build?screen=companies`)

  try {
    const res = await fetch(`${CORE}/api/v1/billing/portal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ return_url: returnUrl }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    const d = data?.data || data
    const url = String(d?.url || d?.portal_url || '')
    if (!res.ok || !url) {
      return Response.json(
        { error: d?.detail || data?.detail || 'could not open billing portal' },
        { status: res.ok ? 502 : res.status },
      )
    }
    return Response.json({ url })
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
