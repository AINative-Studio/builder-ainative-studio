/**
 * /api/build/domains (#207 · FIX-3) — same-origin proxy to core's Namecheap
 * domains API for the Builder custom-domain modal.
 *   GET  ?brand=<slug>  → availability suggestions
 *   POST { domain }     → purchase (requires signed-in user; core gates on auth+confirm)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

export const runtime = 'nodejs'

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''

export async function GET(request: NextRequest) {
  const brand = new URL(request.url).searchParams.get('brand') || ''
  if (!brand) return Response.json({ error: 'brand required' }, { status: 400 })
  try {
    const res = await fetch(`${CORE}/api/v1/public/domains/suggest?brand=${encodeURIComponent(brand)}`, {
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
  if (!body?.domain) return Response.json({ error: 'domain required' }, { status: 400 })

  // Purchase requires a signed-in user (core also gates on confirm). If anonymous,
  // return a signin prompt so the modal drives them into the funnel.
  const session = await auth()
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  try {
    const res = await fetch(`${CORE}/api/v1/public/domains/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: body.domain, years: 1, confirm: body.confirm === true }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'bad response' }))
    return Response.json(data, { status: res.ok ? 200 : res.status })
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e).slice(0, 100) }, { status: 502 })
  }
}
