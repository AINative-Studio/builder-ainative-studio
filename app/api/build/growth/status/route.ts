/**
 * GET /api/build/growth/status?slug=X (#449) — read-only status for the
 * Live dashboard's Growth panel: whether the feature is available, and the
 * company's current funded/campaign/reporting state.
 */

import { NextRequest } from 'next/server'
import { resolveAppVerified } from '@/lib/build/app-registry'
import { growthAdTestingEnabled, growthAdTestingCredentialConfigured } from '@/lib/build/ad-testing'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim()
  const available = growthAdTestingEnabled() && growthAdTestingCredentialConfigured()
  if (!available) {
    return Response.json({ available: false })
  }
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // #832-class bug: resolveApp()'s plain `null` return collapsed "no such
  // company" with "the registry read itself failed" — a transient ZeroDB
  // hiccup made this route falsely 404 "company_not_found" for a real,
  // signed-in founder's own company, same anti-pattern already fixed for
  // /build/{slug} (#1302) and preview-token minting (#1316).
  const { entry: app, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
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
