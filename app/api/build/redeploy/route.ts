/**
 * /api/build/redeploy (#63.A) — redeploy the CURRENT version of a company's app.
 *
 * Finishes the disabled "Redeploy · soon" placeholder on the Live dashboard: it
 * triggers a real Railway redeploy of the currently-live deployment (rebuild/re-run
 * so changes take effect), then health-checks the served URL so the UI can show an
 * honest "redeploying → validating → live" lifecycle.
 *
 * Distinct from #62 (Versions rollback), which redeploys a PRIOR deployment. Here
 * we redeploy the CURRENT one — a no-arg "run it again on the current version".
 *
 * Auth: a REAL (non-guest) session is required and must OWN the company — a redeploy
 * changes the founder's live site, so it is owner-only (mirrors #57 Danger Zone).
 * The owner is proven by the session, never trusted from the body.
 *
 *   POST { companyId }  → { ok, status: 'live'|'redeploying', deploymentId, healthy } | { error }
 *
 * AX (#63): this endpoint is the machine surface — a founder's own agent can trigger
 * a redeploy the same way the UI does.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { resolveApp } from '@/lib/build/app-registry'
import { redeployCurrent, checkDeployHealth } from '@/lib/build/railway-deploy'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const type = (session as any)?.user?.type as string | undefined
  const email = (session as any)?.user?.email as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.slug || '').slice(0, 80).trim()
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })

  const entry = await resolveApp(companyId).catch(() => null)
  if (!entry) return Response.json({ error: 'company not found' }, { status: 404 })

  // Owner-only: the signed-in account must own this company. Companies built
  // anonymously (no ownerEmail) can't be redeployed until claimed.
  const owner = deriveOwnerKey(session as any)
  if (!entry.ownerEmail || entry.ownerEmail.trim().toLowerCase() !== owner) {
    return Response.json({ error: 'not_owner' }, { status: 403 })
  }

  const serviceId = entry.railwayServiceId
  if (!serviceId) {
    // No dedicated Railway service (unpaid / not provisioned) → nothing to redeploy.
    return Response.json({ error: 'no dedicated service to redeploy' }, { status: 400 })
  }

  const result = await redeployCurrent(serviceId)
  if (!result.ok) {
    logger.error('redeploy failed', new Error(result.reason || 'redeploy failed'))
    return Response.json({ error: result.reason || 'redeploy failed', status: 'error' }, { status: 502 })
  }

  // Do NOT declare "live" until the redeployed site is actually serving (#63.A).
  // A single best-effort probe here; the client polls again after the build.
  const url = entry.deployUrl
  const healthy = url ? await checkDeployHealth(url).catch(() => false) : false

  logger.info('redeploy triggered', { companyId, deploymentId: result.deploymentId })
  return Response.json({
    ok: true,
    deploymentId: result.deploymentId,
    status: healthy ? 'live' : 'redeploying',
    healthy,
  })
}
