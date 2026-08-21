/**
 * POST /api/build/provision (#243) — persistent per-company cloud provisioning.
 *
 * Gives a company shipped from /build its OWN real per-company data layer via
 * AINative Instant DB (POST /api/v1/public/instant-db), and persists the project
 * id + key kind onto the company's builder_app_registry entry. This is what turns
 * a preview-only company into one with real, persistent primitives its Live
 * dashboard reads real data from.
 *
 * Two paths (one AINative key + optional user JWT — unified auth):
 *  - Signed-in founder (next-auth session carries an AINative JWT) → provision
 *    AUTHENTICATED → PERMANENT sk_ key immediately, auto-assigned to their Default
 *    Workspace. keyKind = 'permanent'.
 *  - Anonymous → provision UNAUTHENTICATED → tmp_ key (72h expiry) + a claim token.
 *    keyKind = 'tmp'; the claim token is persisted so a later payment (#241) can
 *    upgrade tmp_ → permanent via claimCompanyProject() (no data loss).
 *
 * Gating: gated on the #241 `plan` field when present (paid plan → allow; unknown
 * paid plan → 402). Empty/missing is allowed for the MVP so the seam is exercisable.
 *
 * SECURITY: the raw sk_/tmp_ api_key is returned to THIS caller (server-side) but is
 * NOT written into the shared registry — only project_id + keyKind + claim token are.
 *
 * Body: { slug, name?, plan? }
 * Returns: { ok, zerodbProjectId, keyKind, created, claimable, deployUrl, dnsPointable } | { ok:false, reason }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppProvisioned } from '@/lib/build/app-registry'
import { deployPersistent } from '@/lib/build/deploy'
import { provisionInstantDb } from '@/lib/build/instant-db'
import { provisionPipeline } from '@/lib/build/zeropipeline'

export const runtime = 'nodejs'
export const maxDuration = 60

// Plans that unlock persistent provisioning (#241). Empty/missing is allowed in
// the MVP so the path is testable; tighten to require a paid plan later.
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const slug = String(b?.slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const plan = String(b?.plan || '')
  // Gate: if a plan is set it must be a paid one; unset is allowed (MVP seam).
  if (plan && !PAID_PLANS.has(plan)) {
    return Response.json({ ok: false, reason: 'upgrade', plan }, { status: 402 })
  }

  // Resolve the company so we can attach provisioning to its registry entry and
  // hand the deploy seam its chatId. Must be registered first (built app exists).
  const existing = await resolveApp(slug).catch(() => null)
  if (!existing?.chatId) {
    return Response.json({ ok: false, reason: 'not_registered' }, { status: 404 })
  }

  // A signed-in founder gets a PERMANENT key straight away; anonymous gets a tmp_
  // key that #241's payment flow later claims. Either way we can provision.
  const session = await auth()
  const jwt = (session as any)?.accessToken as string | undefined

  // Already provisioned? Return the persisted project id (idempotent).
  if (existing.zerodbProjectId) {
    const target = await deployPersistent(existing.chatId, slug)
    return Response.json({
      ok: true,
      zerodbProjectId: existing.zerodbProjectId,
      keyKind: existing.keyKind || 'permanent',
      claimable: existing.keyKind === 'tmp',
      created: false,
      deployUrl: existing.deployUrl || target.url,
      dnsPointable: target.dnsPointable,
      cached: true,
    })
  }

  // Provision a REAL Instant DB project. Authenticated → permanent sk_; anonymous
  // → tmp_ + claim token.
  const prov = await provisionInstantDb(jwt)
  if (!prov.ok || !prov.projectId) {
    return Response.json(
      { ok: false, reason: 'provision_failed', detail: prov.reason, status: prov.status },
      { status: 502 },
    )
  }

  // Directive C: also provision the company's REAL ZeroPipeline (CRM) pipeline when
  // we have the founder's JWT (ZeroPipeline is JWT-auth, auto-provisions the org).
  // Best-effort — a failure just leaves the Pipeline card honestly simulated (the
  // gap is tracked in AINative-Studio/ZeroPipeline). Anonymous founders skip this.
  let pipeline: { provisioned: boolean; pipelineId?: string; reason?: string } = { provisioned: false }
  if (jwt) {
    const zp = await provisionPipeline(jwt, slug, String(existing.name || b?.name || slug))
    pipeline = { provisioned: zp.ok, pipelineId: zp.pipelineId, reason: zp.ok ? undefined : zp.reason }
  }

  // Resolve the persistent hosting target (durable preview today; real host later).
  const target = await deployPersistent(existing.chatId, slug)
  const provisionedAt = new Date().toISOString()

  // Persist provisioning onto the company's registry entry so Live/systems read
  // real per-company primitives going forward. We store the project id + key kind
  // (+ claim token for tmp_), NOT the raw api_key (data-plane secret).
  const persisted = await setAppProvisioned(slug, {
    zerodbProjectId: prov.projectId,
    keyKind: prov.keyKind,
    claimToken: prov.claimToken,
    deployUrl: target.url,
    provisionedAt,
    pipelineProvisioned: pipeline.provisioned,
    pipelineId: pipeline.pipelineId,
  })

  return Response.json({
    ok: true,
    zerodbProjectId: prov.projectId,
    keyKind: prov.keyKind,
    // A tmp_ project must be claimed on payment to become permanent (72h expiry).
    claimable: prov.keyKind === 'tmp',
    expiresAt: prov.expiresAt || null,
    created: true,
    pipelineProvisioned: pipeline.provisioned,
    deployUrl: target.url,
    dnsPointable: target.dnsPointable,
    persisted,
    provisionedAt,
  })
}

/** GET ?slug= — read a company's current provisioning status. */
export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''
  const entry = await resolveApp(slug).catch(() => null)
  if (!entry) return Response.json({ provisioned: false })
  return Response.json({
    provisioned: Boolean(entry.zerodbProjectId),
    zerodbProjectId: entry.zerodbProjectId || null,
    keyKind: entry.keyKind || null,
    claimable: entry.keyKind === 'tmp',
    deployUrl: entry.deployUrl || null,
    provisionedAt: entry.provisionedAt || null,
  })
}
