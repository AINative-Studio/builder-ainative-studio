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
 * Returns: { companies: Array<{ slug, name, plan, ... }>, ok: true } |
 *          { companies: [], ok: false, error: 'registry_unavailable' } | { error }
 *
 * Real bug found live (2026-09-13, core#7395): a real ZeroDB outage (the
 * registry read failing) used to come back through this same code path as
 * `{ companies: [] }` — indistinguishable from a founder who genuinely has
 * no companies yet. A real founder (arif@8genc.com) reported their projects
 * had "disappeared" from the dashboard; the actual cause was a platform-wide
 * database outage, not their data being lost. `ok` now tells the client
 * which one it actually is, so the UI can show an honest "couldn't load
 * your companies right now" state instead of a false empty one.
 */

import { auth } from '@/app/(auth)/auth'
import { listAppsForOwnerWithStatus } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

export async function GET() {
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  if (!email) return Response.json({ error: 'not signed in' }, { status: 401 })

  const { apps, ok } = await listAppsForOwnerWithStatus(email).catch(() => ({ apps: [], ok: false }))
  if (!ok) {
    return Response.json(
      { companies: [], ok: false, error: 'registry_unavailable' },
      { status: 503 },
    )
  }
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

  return Response.json({ companies, ok: true })
}
