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
import {
  provisionInstantDb,
  fileProjectUnderBuilderWorkspace,
  BUILDER_WORKSPACE_ID,
  TRIAL_WINDOW_MS,
} from '@/lib/build/instant-db'
import { provisionPipeline } from '@/lib/build/zeropipeline'
import { provisionStore } from '@/lib/build/zerocommerce'
import { provisionCapTable } from '@/lib/build/opencapstack'
import { provisionForm } from '@/lib/build/zeroforms'
import { provisionProject } from '@/lib/build/agentflow'
import { provisionZeroDbViaMcp, isMcpProvisionEnabled } from '@/lib/build/mcp-provision'
import { provisionCompanyRepo } from '@/lib/git/company-repo'
import { resolveStoredApp } from '@/lib/build/ready-gate'

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
    const target = await deployPersistent(existing.chatId, slug, existing)
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

  // #73 build-time MCP wedge: when ENABLE_MCP_PROVISION is set (and MCP creds are
  // configured), Cody OPERATES the ZeroDB MCP (69 tools) to create the REAL project
  // agentically — the strategic differentiator over code-gen-only competitors.
  // Inert + safe by default: with the flag off (or no creds / any failure) this is a
  // no-op and we fall through to the existing Instant-DB REST path below. Only a
  // successful MCP provision short-circuits; a preview then reads a real
  // MCP-provisioned ZeroDB, not a mock.
  if (isMcpProvisionEnabled()) {
    const mcp = await provisionZeroDbViaMcp({
      slug,
      name: String(existing.name || b?.name || slug),
    })
    if (mcp.ok && mcp.projectId) {
      const target = await deployPersistent(existing.chatId, slug, existing)
      const provisionedAt = new Date().toISOString()
      const persisted = await setAppProvisioned(slug, {
        zerodbProjectId: mcp.projectId,
        keyKind: 'permanent',
        provisionedAt,
        deployUrl: target.url,
        workspaceId: BUILDER_WORKSPACE_ID,
      })
      return Response.json({
        ok: true,
        zerodbProjectId: mcp.projectId,
        keyKind: 'permanent',
        trial: false,
        claimable: false,
        expiresAt: null,
        plan: plan || null,
        created: true,
        provisionedVia: 'mcp',
        tablesCreated: mcp.tablesCreated || [],
        deployUrl: target.url,
        dnsPointable: target.dnsPointable,
        persisted,
        provisionedAt,
      })
    }
    // Not ok / skipped → fall through to Instant DB (unchanged behavior).
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

  // #417 (child of #414): also provision the company's REAL ZeroCommerce store
  // when we have the founder's JWT (same direct-JWT-bearer auth as ZeroPipeline
  // — confirmed via ZeroCommerce's own OpenAPI spec, no OAuth redirect needed).
  // Best-effort — a failure just leaves the Commerce card honestly simulated.
  // No cost-safety gating needed (software-only store record, no recurring
  // resource cost the way ZeroVoice's phone numbers have, #415).
  let commerce: { provisioned: boolean; storeId?: string; reason?: string } = { provisioned: false }
  if (jwt) {
    const zc = await provisionStore(jwt, slug, String(existing.name || b?.name || slug))
    commerce = { provisioned: zc.ok, storeId: zc.storeId, reason: zc.ok ? undefined : zc.reason }
  }

  // #427 (child of #414/#422): also provision the company's REAL OpenCapStack
  // cap table. Unlike ZeroPipeline/ZeroCommerce this doesn't need the founder's
  // JWT — OpenCapStack has no AINative-federated auth, so it authenticates as
  // a dedicated builder service account instead (env-configured; provisionCapTable
  // no-ops honestly if that account isn't configured). Best-effort — a failure
  // just leaves the cap table card honestly simulated.
  let capstack: { provisioned: boolean; companyId?: string; reason?: string } = { provisioned: false }
  {
    const ocs = await provisionCapTable(String(existing.name || b?.name || slug))
    capstack = { provisioned: ocs.ok, companyId: ocs.companyId, reason: ocs.ok ? undefined : ocs.reason }
  }

  // #421 (child of #414): also provision the company's REAL ZeroForms default
  // form when we have the founder's JWT (same direct-JWT-bearer auth as
  // ZeroPipeline/ZeroCommerce — confirmed via ZeroForms' own source, which
  // maps a validated AINative key onto a User with is_verified=True set
  // explicitly, satisfying the require_verified gate on form creation with
  // no separate ZeroForms signup/dashboard step). Best-effort — a failure
  // just leaves the Forms card honestly simulated. No cost-safety gating
  // needed (software-only form record, no recurring resource cost).
  let forms: { provisioned: boolean; formId?: string; reason?: string } = { provisioned: false }
  if (jwt) {
    const zf = await provisionForm(jwt, slug, String(existing.name || b?.name || slug))
    forms = { provisioned: zf.ok, formId: zf.formId, reason: zf.ok ? undefined : zf.reason }
  }

  // #419 (child of #414): also provision the company's REAL AgentFlow default
  // project when we have the founder's JWT. Same direct-JWT-bearer auth as
  // ZeroPipeline/ZeroCommerce/ZeroForms — AgentFlow's original credential-shape
  // mismatch (password-only login) was fixed upstream instead of worked around
  // here (AINative-Studio/AgentFlow#73/#74): its auth now falls back to
  // verifying an AINative platform JWT directly, auto-provisioning a local
  // user on first use. Best-effort — a failure just leaves the AgentFlow card
  // honestly simulated. No cost-safety gating needed (software-only project
  // record, no recurring resource cost).
  let agentflow: { provisioned: boolean; projectId?: string; reason?: string } = { provisioned: false }
  if (jwt) {
    const af = await provisionProject(jwt, slug, String(existing.name || b?.name || slug))
    agentflow = { provisioned: af.ok, projectId: af.projectId, reason: af.ok ? undefined : af.reason }
  }

  // #250: file this company's project under the AINative Builder workspace, so all
  // generated companies live under one workspace instead of the Builder key's default
  // "AINative Studio". Instant DB doesn't honor the workspace_id we send on create yet
  // (core PR #6460), so we best-effort re-parent via PATCH here. This only sticks for
  // admin-owned (permanent/paid) projects; tmp_ trials aren't admin-owned and get
  // filed later (on claim, or once core honors workspace_id). Never fails provisioning.
  const filed = await fileProjectUnderBuilderWorkspace(prov.projectId).catch(
    () => ({ filed: false, reason: 'exception' } as Awaited<ReturnType<typeof fileProjectUnderBuilderWorkspace>>),
  )
  if (!filed.filed) {
    console.warn(
      `[provision] project ${prov.projectId} not filed under Builder workspace (${BUILDER_WORKSPACE_ID}):`,
      filed.reason || filed.status,
    )
  }

  // Resolve the persistent hosting target (durable preview today; real host later).
  const target = await deployPersistent(existing.chatId, slug, existing)
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
    commerceProvisioned: commerce.provisioned,
    commerceStoreId: commerce.storeId,
    capstackProvisioned: capstack.provisioned,
    capstackCompanyId: capstack.companyId,
    formsProvisioned: forms.provisioned,
    formsFormId: forms.formId,
    agentflowProvisioned: agentflow.provisioned,
    agentflowProjectId: agentflow.projectId,
    // #250: record the intended Builder workspace + whether the re-parent stuck.
    workspaceId: BUILDER_WORKSPACE_ID,
    workspaceFiled: filed.filed,
  })

  // #349: Provision per-company Gitea repo and push initial commit. Best-effort —
  // a failure logs but doesn't block the main provisioning response. The git repo
  // gives founders real version history + PR-based code review for task changes.
  let gitProvisioned = false
  let gitResult: { gitRepoUrl?: string; gitRepoId?: string; gitOrg?: string; reason?: string } = {}
  try {
    const stored = await resolveStoredApp(existing.chatId)
    if (stored?.files && Object.keys(stored.files).length > 0) {
      const git = await provisionCompanyRepo({
        workspaceId: BUILDER_WORKSPACE_ID,
        slug,
        files: stored.files,
      })
      gitProvisioned = git.ok
      gitResult = git
      if (!git.ok) {
        console.warn(`[provision] Git repo provision failed for ${slug}: ${git.reason}`)
      }
    }
  } catch (err) {
    console.warn(`[provision] Git repo provision error for ${slug}:`, err)
  }

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
    commerceProvisioned: commerce.provisioned,
    capstackProvisioned: capstack.provisioned,
    formsProvisioned: forms.provisioned,
    agentflowProvisioned: agentflow.provisioned,
    gitProvisioned,
    gitRepoUrl: gitResult.gitRepoUrl,
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
