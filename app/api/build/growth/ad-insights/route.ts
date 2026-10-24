/**
 * POST /api/build/growth/ad-insights (#449) — refresh + return the real
 * clicks/CPC snapshot for a company's ad-test campaign, for the Live
 * dashboard's Growth card.
 *
 * Body: { slug } → { ok, clicks?, cpcCents?, syncedAt? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveAppVerified, setAppGrowthAdInsights } from '@/lib/build/app-registry'
import { fetchAdTestInsights } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const session = await auth().catch(() => null)
  if (!(session as any)?.accessToken) {
    return Response.json({ ok: false, reason: 'signin' })
  }

  // #832-class bug: resolveApp()'s plain `null` return collapsed "no such
  // company" with "the registry read itself failed" — a transient ZeroDB
  // hiccup here would falsely tell a founder their company doesn't exist
  // while just trying to refresh their Growth card's ad insights.
  const { entry: app, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })
  if (!app.growthAdTestCampaignId) {
    return Response.json({ ok: false, reason: 'no_campaign' })
  }

  const result = await fetchAdTestInsights(app.growthAdTestCampaignId)
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason || 'insights_unavailable' })
  }

  await setAppGrowthAdInsights(slug, { clicks: result.clicks || 0, cpcCents: result.cpcCents || 0 }).catch(() => {})

  return Response.json({ ok: true, clicks: result.clicks, cpcCents: result.cpcCents })
}
