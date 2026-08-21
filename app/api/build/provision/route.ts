/**
 * POST /api/build/provision (#243) — persistent per-company cloud provisioning.
 *
 * Creates (idempotently) a REAL ZeroDB project for the company via core's
 * /api/v1/zerodb/projects/ensure, persists the provisioned project id + deploy
 * target onto the company's builder_app_registry entry, and returns them. This
 * is what turns a preview-only company into one with real, persistent primitives
 * (its own ZeroDB project) that the Live dashboard reads real data from.
 *
 * Gating: provisioning a durable per-company project is a paid-tier capability.
 * We gate on the #241 plan field when present (plan 'company' | 'launch' → allow;
 * '' or missing → allow for MVP so the seam is exercisable). A signed-in user is
 * required because the ZeroDB project is created under (and owned by) their account.
 *
 * Body: { slug, name?, plan? }
 * Returns: { ok, zerodbProjectId, created, deployUrl, dnsPointable } | { ok:false, reason }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppProvisioned } from '@/lib/build/app-registry'
import { deployPersistent } from '@/lib/build/deploy'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CORE = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'

// Plans that unlock persistent provisioning (#241). Empty/missing is allowed in
// the MVP so the path is testable; tighten to require a paid plan later.
const PAID_PLANS = new Set(['launch', 'company'])

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const slug = String(b?.slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  const plan = String(b?.plan || '')
  // Gate: if a plan is set it must be a paid one; unset is allowed (MVP seam).
  if (plan && !PAID_PLANS.has(plan)) {
    return Response.json({ ok: false, reason: 'upgrade', plan }, { status: 402 })
  }

  // Creating a durable per-company ZeroDB project requires a signed-in owner.
  const session = await auth()
  const token = (session as any)?.accessToken
  if (!token) return Response.json({ ok: false, reason: 'signin' })

  // Resolve the company so we can attach provisioning to its registry entry and
  // hand the deploy seam its chatId. Must be registered first (built app exists).
  const existing = await resolveApp(slug).catch(() => null)
  if (!existing?.chatId) {
    return Response.json({ ok: false, reason: 'not_registered' }, { status: 404 })
  }

  // Already provisioned? Return the persisted project id (idempotent).
  if (existing.zerodbProjectId) {
    const target = await deployPersistent(existing.chatId, slug)
    return Response.json({
      ok: true,
      zerodbProjectId: existing.zerodbProjectId,
      created: false,
      deployUrl: existing.deployUrl || target.url,
      dnsPointable: target.dnsPointable,
      cached: true,
    })
  }

  // Provision a REAL ZeroDB project via core's idempotent ensure endpoint. It is
  // keyed by a stable repo_hash so repeated calls return the same project.
  const repoHash = createHash('sha256').update(`builder-company:${slug}`).digest('hex').slice(0, 16)
  const name = String(existing.name || b?.name || slug).slice(0, 120)

  let zerodbProjectId = ''
  let created = false
  try {
    const res = await fetch(`${CORE}/api/v1/zerodb/projects/ensure`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_hash: repoHash, repo_name: name, tier: 'pro' }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.project?.id) {
      return Response.json(
        { ok: false, reason: 'provision_failed', detail: String(data?.detail || res.status).slice(0, 200) },
        { status: 502 },
      )
    }
    zerodbProjectId = String(data.project.id)
    created = Boolean(data.project.created)
  } catch (e: any) {
    return Response.json(
      { ok: false, reason: 'provision_failed', detail: String(e?.message || e).slice(0, 120) },
      { status: 502 },
    )
  }

  // Resolve the persistent hosting target (durable preview today; real host later).
  const target = await deployPersistent(existing.chatId, slug)
  const provisionedAt = new Date().toISOString()

  // Persist provisioning onto the company's registry entry so Live/systems read
  // real per-company primitives going forward.
  const persisted = await setAppProvisioned(slug, {
    zerodbProjectId,
    deployUrl: target.url,
    provisionedAt,
  })

  return Response.json({
    ok: true,
    zerodbProjectId,
    created,
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
    deployUrl: entry.deployUrl || null,
    provisionedAt: entry.provisionedAt || null,
  })
}
