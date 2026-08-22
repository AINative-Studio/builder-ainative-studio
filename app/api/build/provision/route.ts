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
import { resolveApp, setAppProvisioned, setAppOwner } from '@/lib/build/app-registry'
import { deployPersistent } from '@/lib/build/deploy'
import { provisionInstantDb, TRIAL_WINDOW_MS } from '@/lib/build/instant-db'
import { provisionPipeline } from '@/lib/build/zeropipeline'

export const runtime = 'nodejs'
export const maxDuration = 60

// Plans that unlock a PERMANENT project + real provisioning (#207/#241). A
// permanent (sk_) key requires one of these — provisioning is PAID-gated.
const PAID_PLANS = new Set(['launch', 'company', 'pro', 'business', 'enterprise', 'cody_vcto'])

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const slug = String(b?.slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // Resolve the company so we can attach provisioning to its registry entry and
  // hand the deploy seam its chatId. Must be registered first (built app exists).
  const existing = await resolveApp(slug).catch(() => null)
  if (!existing?.chatId) {
    return Response.json({ ok: false, reason: 'not_registered' }, { status: 404 })
  }

  // Provisioning policy (#207): PERMANENT (sk_) requires a PAID subscription; an
  // UNPAID user gets a REAL 72h `tmp_` trial project (no hard paywall). The trial
  // is the conversion hook — after they pay, the tmp_ project is claimed →
  // permanent (claimCompanyProject, from subscription/verify), so their work
  // survives. The plan is read from the server-verified registry entry, NEVER the
  // request body.
  const plan = String(existing.plan || '')
  const isPaid = PAID_PLANS.has(plan)

  // Founder's JWT (used ONLY for a permanent, paid provision + ZeroPipeline —
  // NEVER for a tmp_ trial, so an unpaid signed-in user can't mint a permanent key).
  const session = await auth()
  const jwt = (session as any)?.accessToken as string | undefined
  // #253: stamp the signed-in founder as this company's owner so it appears in
  // their "my companies" index (best-effort; independent of paid/trial state).
  const ownerEmail = (session as any)?.user?.email as string | undefined
  if (ownerEmail) setAppOwner(slug, ownerEmail).catch(() => {})

  // Already provisioned? Return the persisted project id (idempotent).
  if (existing.zerodbProjectId) {
    const target = await deployPersistent(existing.chatId, slug)
    // Backfill: a tmp_ trial provisioned before #260 may have no trialExpiresAt
    // (blank countdown). Anchor it to provisionedAt + 72h (or now + 72h) and
    // persist so the value is stable across reads. Permanent projects never expire.
    let trialExpiresAt = existing.trialExpiresAt
    if (existing.keyKind === 'tmp' && !trialExpiresAt) {
      const anchor = existing.provisionedAt ? new Date(existing.provisionedAt).getTime() : Date.now()
      trialExpiresAt = new Date(anchor + TRIAL_WINDOW_MS).toISOString()
      await setAppProvisioned(slug, { trialExpiresAt, provisionedAt: existing.provisionedAt }).catch(() => {})
    }
    return Response.json({
      ok: true,
      zerodbProjectId: existing.zerodbProjectId,
      keyKind: existing.keyKind || 'permanent',
      trial: existing.keyKind === 'tmp',
      claimable: existing.keyKind === 'tmp',
      expiresAt: existing.keyKind === 'tmp' ? (trialExpiresAt || null) : null,
      created: false,
      deployUrl: existing.deployUrl || target.url,
      dnsPointable: target.dnsPointable,
      cached: true,
    })
  }

  // Provision a REAL Instant DB project. Paid + JWT → permanent sk_ immediately.
  // (Gate above already guarantees isPaid here; passing permanent=isPaid keeps the
  // intent explicit and future-proof if the gate is ever relaxed.)
  const prov = await provisionInstantDb(jwt, isPaid)
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

  // Trial expiry only for tmp_ (unpaid) projects — drives the Live "Free trial:
  // Xh left" countdown/upgrade UI. Instant DB normally returns expires_at, but for
  // tmp_ keys it can be missing/empty (#260); fall back to now + 72h so the
  // countdown always has a real value. Permanent (paid) projects never expire.
  const trialExpiresAt =
    prov.keyKind === 'tmp'
      ? prov.expiresAt || new Date(Date.now() + TRIAL_WINDOW_MS).toISOString()
      : undefined

  // Persist provisioning onto the company's registry entry so Live/systems read
  // real per-company primitives going forward. We store the project id + key kind
  // (+ claim token for tmp_), NOT the raw api_key (data-plane secret).
  const persisted = await setAppProvisioned(slug, {
    zerodbProjectId: prov.projectId,
    keyKind: prov.keyKind,
    claimToken: prov.claimToken,
    trialExpiresAt,
    deployUrl: target.url,
    provisionedAt,
    pipelineProvisioned: pipeline.provisioned,
    pipelineId: pipeline.pipelineId,
  })

  return Response.json({
    ok: true,
    zerodbProjectId: prov.projectId,
    keyKind: prov.keyKind,
    // trial = unpaid 72h tmp_ project (the conversion hook). Claim on payment to
    // keep it (tmp_ → permanent). Paid users get a permanent project outright.
    trial: prov.keyKind === 'tmp',
    claimable: prov.keyKind === 'tmp',
    // The persisted trial expiry (Instant DB expires_at, or the 72h fallback) so
    // the client gets a real countdown value even when core returns no expires_at.
    expiresAt: trialExpiresAt || null,
    plan: plan || null,
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
  const isTrial = entry.keyKind === 'tmp'
  // A tmp_ trial must always report a real expiry so Live's "Free trial: Xh left"
  // countdown shows a number. If the persisted value is missing (e.g. Instant DB
  // returned no expires_at, #260), anchor it to provisionedAt + 72h (or now + 72h)
  // and persist it so it's stable across reads. Permanent projects never expire.
  let trialExpiresAt = entry.trialExpiresAt || null
  if (isTrial && !trialExpiresAt) {
    const anchor = entry.provisionedAt ? new Date(entry.provisionedAt).getTime() : Date.now()
    trialExpiresAt = new Date(anchor + TRIAL_WINDOW_MS).toISOString()
    await setAppProvisioned(slug, { trialExpiresAt, provisionedAt: entry.provisionedAt }).catch(() => {})
  }
  const expired = Boolean(isTrial && trialExpiresAt && new Date(trialExpiresAt).getTime() < Date.now())
  return Response.json({
    provisioned: Boolean(entry.zerodbProjectId),
    zerodbProjectId: entry.zerodbProjectId || null,
    keyKind: entry.keyKind || null,
    trial: isTrial,
    claimable: isTrial,
    trialExpiresAt: isTrial ? trialExpiresAt : null,
    trialExpired: expired,
    plan: entry.plan || null,
    deployUrl: entry.deployUrl || null,
    provisionedAt: entry.provisionedAt || null,
  })
}
