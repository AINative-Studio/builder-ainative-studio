/**
 * GET /api/build/my-companies (#253) — the signed-in founder's built companies.
 *
 * Backs the "my companies" index: a founder can leave and come back, find every
 * company they built/claimed, open its Live dashboard, and see real ownership
 * handles (project id, domain, deploy URL, plan). Owner association is stamped at
 * provision/checkout time (see setAppOwner). Anonymous → 401.
 *
 * Ownership-forward by design (beat Polsia): we return the REAL handles the
 * founder owns — the ZeroDB project id, the custom domain, the deploy URL — not
 * locked black boxes.
 *
 * Returns: { companies: Array<{ slug, name, plan, ... }> } | { error }
 */

import { auth } from '@/app/(auth)/auth'
import { listAppsForOwner } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function GET() {
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  if (!email) return Response.json({ error: 'not signed in' }, { status: 401 })

  const apps = await listAppsForOwner(email).catch(() => [])
  const companies = apps.map((e) => ({
    slug: e.slug,
    name: e.name || e.slug,
    tagline: e.tagline || '',
    color: e.color || null,
    track: e.track || 'app',
    plan: e.plan || null,                 // active subscription tier, if paid
    enrolled: Boolean(e.enrolled),
    // Ownership handles (beat Polsia) — real, not black boxes.
    zerodbProjectId: e.zerodbProjectId || null,
    domain: e.domain || null,
    deployUrl: e.deployUrl || `${APP}/build/${e.slug}`,
    keyKind: e.keyKind || null,           // 'tmp' = trial, 'permanent' = owned
    trialExpiresAt: e.trialExpiresAt || null,
    createdAt: e.createdAt || null,
    // Where the founder opens this company's Live dashboard again.
    liveUrl: `${APP}/build?screen=live&company=${encodeURIComponent(e.slug)}`,
  }))

  return Response.json({ companies })
}
