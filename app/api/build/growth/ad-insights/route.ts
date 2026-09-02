/**
 * POST /api/build/growth/ad-insights (#449) — refresh + return the real
 * clicks/CPC snapshot for a company's ad-test campaign, for the Live
 * dashboard's Growth card.
 *
 * Body: { slug } → { ok, clicks?, cpcCents?, syncedAt? }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppGrowthAdInsights } from '@/lib/build/app-registry'
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

  const app = await resolveApp(slug).catch(() => null)
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
