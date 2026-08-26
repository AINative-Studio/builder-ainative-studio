/**
 * /api/build/domains (#207 · FIX-3 / #240) — same-origin proxy to core's
 * Namecheap domains API for the Builder custom-domain modal.
 *   GET  ?brand=<slug>[&offset=N] → availability suggestions (offset → "More options")
 *   GET  ?check=<domain>          → availability + price for an EXACT typed domain (#280)
 *   POST { domain, slug }         → start Stripe checkout to BUY the domain
 *   PUT  { session_id }           → fulfill after payment (register + point DNS)
 *
 * The purchase is charge-first: POST returns a Stripe Checkout URL; after the
 * user pays, Stripe redirects back to Live with ?domain_session=…, and the modal
 * calls PUT to register the domain + point DNS at the company's app.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { setAppDomain } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)

  // Exact-domain search (#280): ?check=<domain> → core /domains/check. The founder
  // types a specific domain; we return availability + price (+ close TLD variants).
  const check = (url.searchParams.get('check') || '').trim().slice(0, 63)
  if (check) {
    try {
      const res = await fetch(`${CORE}/api/v1/public/domains/check?domain=${encodeURIComponent(check)}`, {
        headers: { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY },
        signal: AbortSignal.timeout(20000),
      })
      const data = await res.json().catch(() => ({ configured: false, suggestions: [] }))
      return Response.json(data)
    } catch {
      return Response.json({ configured: false, suggestions: [] })
    }
  }

  const brand = url.searchParams.get('brand') || ''
  // Company context (idea/industry) so core can generate ON-BRAND alternatives
  // when the bare word is taken (embercoffee, drinkember, ember.shop…) instead of
  // dead-ending. Optional — degrades to generic variants when absent.
  const keywords = url.searchParams.get('keywords') || ''
  // Pagination for "More options →" (#280): skip the first N available options.
  const offsetRaw = parseInt(url.searchParams.get('offset') || '0', 10)
  const offset = Number.isFinite(offsetRaw) ? Math.min(Math.max(offsetRaw, 0), 60) : 0
  if (!brand) return Response.json({ error: 'brand required' }, { status: 400 })
  const qs = `brand=${encodeURIComponent(brand)}${keywords ? `&keywords=${encodeURIComponent(keywords.slice(0, 200))}` : ''}${offset ? `&offset=${offset}` : ''}`
  try {
    const res = await fetch(`${CORE}/api/v1/public/domains/suggest?${qs}`, {
      headers: { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY },
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => ({ configured: false, suggestions: [] }))
    return Response.json(data)
  } catch {
    return Response.json({ configured: false, suggestions: [] })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const domain = String(body?.domain || '')
  const slug = String(body?.slug || '')
  if (!domain || !slug) return Response.json({ error: 'domain and slug required' }, { status: 400 })

  // Buying a domain requires a signed-in user (it's a real charge + a durable
  // asset tied to their account). Anonymous → drive them into the funnel first.
  const session = await auth()
  const token = (session as any)?.accessToken
  const email = (session as any)?.user?.email
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  try {
    const res = await fetch(`${CORE}/api/v1/public/domains/purchase`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain,
        slug,
        email,
        // Return to the company's LIVE DASHBOARD (the SPA screen), not the public
        // /build/{slug} app page. `/build/{slug}` renders the built app for visitors;
        // the founder must land back on their dashboard where the modal fulfills on
        // ?domain_session (success) or simply reopens on cancel. Both used to point at
        // the public app page, which stranded the founder on their own app view.
        success_url: `${APP}/build?screen=live&company=${encodeURIComponent(slug)}&domain_session={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP}/build?screen=live&company=${encodeURIComponent(slug)}&domain_cancelled=1`,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'bad response' }))
    return Response.json(data, { status: res.ok ? 200 : res.status })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}

// (used by PUT below — see fulfillment)

// Fulfill: after Stripe redirects back with a session id, verify payment and
// register + point DNS. Safe to call on page load with the returned session id.
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const sessionId = String(body?.session_id || '')
  if (!sessionId) return Response.json({ error: 'session_id required' }, { status: 400 })

  try {
    const res = await fetch(`${CORE}/api/v1/public/domains/fulfill`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'X-API-Key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(40000),
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'bad response' }))
    // Persist the domain on the company so Live can show it going forward.
    if (data?.domain && data?.slug && (data?.ok || data?.registered)) {
      setAppDomain(String(data.slug), String(data.domain)).catch(() => {})
    }
    return Response.json(data, { status: res.ok ? 200 : res.status })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
