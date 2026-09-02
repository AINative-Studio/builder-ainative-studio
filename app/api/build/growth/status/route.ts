/**
 * GET /api/build/growth/status?slug=X (#449) — read-only status for the
 * Live dashboard's Growth panel: whether the feature is available, and the
 * company's current funded/campaign/reporting state.
 */

import { NextRequest } from 'next/server'
import { resolveApp } from '@/lib/build/app-registry'
import { growthAdTestingEnabled, growthAdTestingCredentialConfigured } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  const available = growthAdTestingEnabled() && growthAdTestingCredentialConfigured()
  if (!available) {
    return Response.json({ available: false })
  }
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  return Response.json({
    available: true,
    campaignId: app.growthAdTestCampaignId,
    fundedCents: app.growthAdBudgetRequestedCents,
    realBudgetCents: app.growthAdBudgetRealCents,
    clicks: app.growthAdTestClicks,
    cpcCents: app.growthAdTestCpcCents,
    insightsSyncedAt: app.growthAdTestInsightsSyncedAt,
  })
}
