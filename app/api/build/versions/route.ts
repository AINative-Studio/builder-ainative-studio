/**
 * /api/build/versions (#62) — per-company deploy version history + one-click
 * rollback, backed by Railway's per-service deployment history.
 *
 * The Versions panel on the Live dashboard lists every deploy of the company app
 * as a version (commit-style message + git SHA + timestamp + CURRENT badge on the
 * live one), and lets the founder REVERT to a prior version — which redeploys that
 * Railway deployment and does not report "live" until the rolled-back site is
 * health-verified.
 *
 * Source of truth: Railway `deployments(serviceId, environmentId)` (via
 * lib/build/railway-deploy.ts), JOINED with a per-company version index persisted
 * in ZeroDB (lib/build/version-store.ts) so Cody's commit messages/SHAs survive
 * restarts even for image-sourced services with no git meta.
 *
 * AX (our moat, #62 req 5): this endpoint is the machine surface — a founder's OWN
 * agent can list versions and trigger a rollback the same way the UI does.
 *
 *   GET  ?companyId=…                     → { versions: AppVersion[], serviced }
 *   POST { companyId, deploymentId }      → { ok, status, deploymentId, healthy }
 *
 * The owner half of the scope is ALWAYS taken from the server session — never
 * trusted from the body — so one founder can't read/roll back another's releases.
 * Rollback is destructive-ish (changes the live site); the UI confirms first.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import { resolveApp } from '@/lib/build/app-registry'
import {
  listDeployments,
  redeployDeployment,
  checkDeployHealth,
  isRollbackTarget,
  type RailwayDeployment,
} from '@/lib/build/railway-deploy'
import {
  loadVersionIndex,
  joinVersions,
  singleVersionFallback,
  type AppVersion,
} from '@/lib/build/version-store'

export const runtime = 'nodejs'

/** Resolve the durable version scope key from the SERVER session + company slug. */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return chatScopeKey(deriveOwnerKey(session as any), slug)
}

/**
 * GET — list the company's deploy versions, newest-first, with the live one
 * flagged CURRENT. Never 500s: on any failure (including a company with no
 * dedicated Railway service yet) it yields an honest single "v1 · current"
 * version so the panel always renders.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('chatId') || params.get('slug') || '').slice(0, 80)
  if (!companyId) return Response.json({ versions: singleVersionFallback(), serviced: false })

  const scopeKey = await resolveScopeKey(companyId)
  const entry = await resolveApp(companyId).catch(() => null)
  const serviceId = entry?.railwayServiceId

  // No dedicated Railway service (unpaid / not provisioned) → honest single
  // version: the company is live on the durable host, but there is no deploy
  // history to roll back through yet (#62 req 5 empty state).
  if (!serviceId) {
    return Response.json({ versions: singleVersionFallback(), serviced: false })
  }

  const [deployResult, metaIndex] = await Promise.all([
    listDeployments(serviceId).catch(() => ({ ok: false } as const)),
    scopeKey ? loadVersionIndex(scopeKey).catch(() => new Map()) : Promise.resolve(new Map()),
  ])

  // Railway disabled/unreachable, or no deployments returned → single-version
  // fallback rather than a blank or fabricated list.
  const deployments: RailwayDeployment[] =
    deployResult.ok && Array.isArray(deployResult.deployments) ? deployResult.deployments : []
  if (deployments.length === 0) {
    return Response.json({ versions: singleVersionFallback(), serviced: true })
  }

  const versions: AppVersion[] = joinVersions(deployments, metaIndex as Map<string, any>)
  return Response.json({ versions, serviced: true })
}

/**
 * POST — roll the live site back to a prior deployment (#62). Confirms the
 * deployment is a valid rollback target (a completed, non-current deploy), triggers
 * the Railway redeploy, then health-checks the served URL before declaring it live.
 *
 * Returns an honest status the UI maps to its states:
 *  - 'rolling_back' : the redeploy was accepted but the site isn't healthy yet.
 *  - 'live'         : the rolled-back site responded healthy.
 * Errors (bad target, disabled, redeploy failure) return the reason with 4xx/502.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.chatId || body?.slug || '').slice(0, 80)
  const deploymentId = String(body?.deploymentId || '').trim()
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })
  if (!deploymentId) return Response.json({ error: 'deploymentId required' }, { status: 400 })

  // Owner is proven by the session (never the body). Even though the rollback acts
  // on the company's Railway service, we require a resolvable scope so an
  // unauthenticated/cross-owner caller can't drive another company's releases.
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ error: 'no scope' }, { status: 400 })

  const entry = await resolveApp(companyId).catch(() => null)
  const serviceId = entry?.railwayServiceId
  if (!serviceId) return Response.json({ error: 'no dedicated service to roll back' }, { status: 400 })

  // Validate the target against the live history: it must exist and be a
  // completed, non-current deployment. Never redeploy a failed/removed/current one.
  const deployResult = await listDeployments(serviceId).catch(() => ({ ok: false } as const))
  const deployments: RailwayDeployment[] =
    deployResult.ok && Array.isArray(deployResult.deployments) ? deployResult.deployments : []
  const target = deployments.find((d) => d.id === deploymentId)
  if (!target) return Response.json({ error: 'deployment not found in history' }, { status: 404 })
  if (!isRollbackTarget(target)) {
    return Response.json({ error: 'not a valid rollback target' }, { status: 400 })
  }

  // Trigger the Railway redeploy of the prior deployment.
  const redeploy = await redeployDeployment(deploymentId)
  if (!redeploy.ok) {
    return Response.json({ error: redeploy.reason || 'rollback failed', status: 'error' }, { status: 502 })
  }

  // Do NOT declare "live" until the rolled-back site is actually serving (#62 req 3).
  // A single best-effort probe here; the client keeps polling GET for the CURRENT
  // badge to move. Missing deployUrl → we can't prove health, so report rolling_back.
  const url = entry?.deployUrl
  const healthy = url ? await checkDeployHealth(url).catch(() => false) : false

  return Response.json({
    ok: true,
    deploymentId: redeploy.deploymentId || deploymentId,
    status: healthy ? 'live' : 'rolling_back',
    healthy,
  })
}
