/**
 * GET/POST /api/build/credits (#dashboard-ux — freemium enforcement).
 *
 * GET  → the signed-in founder's build-credit status { used, limit, remaining,
 *        allowed, unlimited } for their resolved tier. Drives the "X of 3 builds"
 *        UI and lets the client know whether to gate.
 * POST → records one build for the founder IF they're within their allowance, and
 *        returns the post-record status. Returns 402 { error:'build_limit_reached' }
 *        when the free/starter allowance is exhausted so the client can route to
 *        the upgrade screen instead of starting a build.
 *
 * Identity is the signed-in account email. The auth wall guarantees a build is only
 * ever started by a registered founder, so an anonymous caller here is a 401.
 *
 * Ecosystem runway (#324 GR-15): a build that composes >= 2 AINative primitives
 * beyond the default substrate earns extra free-build allowance. The primitives
 * are computed HERE, server-side, from the founder's idea via the SAME
 * deterministic selection the composition pipeline uses (selectPrimitives) —
 * any client-sent primitives list is ignored. getBuildCreditStatus folds the
 * earned bonus into the effective limit, so the 402 threshold accounts for it.
 */
import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import {
  getBuildCreditStatus,
  recordBuild,
  recordPreviewReached,
  hasReachedPreview,
  applyValueGuarantee,
} from '@/lib/build/build-credits'
import { selectPrimitives } from '@/lib/build/primitive-catalog'
import { countEcosystemPrimitives, ecosystemBonusMessage } from '@/lib/build/ecosystem-bonus'

export const runtime = 'nodejs'

async function resolveOwner(): Promise<{ email: string; tier: string } | null> {
  try {
    const session = await auth()
    const email = (session as any)?.user?.email as string | undefined
    const accessToken = (session as any)?.accessToken as string | undefined
    if (!email) return null
    let tier = 'hobbyist'
    if (accessToken) {
      try {
        const status = await getPlanStatus(accessToken)
        tier = status.tier || 'hobbyist'
      } catch {
        /* fall back to free-tier allowance */
      }
    }
    return { email, tier }
  } catch {
    return null
  }
}

export async function GET() {
  const owner = await resolveOwner()
  if (!owner) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const status = await getBuildCreditStatus(owner.email, owner.tier)
  return NextResponse.json({ ...status, tier: owner.tier })
}

export async function POST(request: Request) {
  const owner = await resolveOwner()
  if (!owner) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const slug = typeof body?.slug === 'string' ? body.slug : undefined

  // Value-moment event (#310/#311): the client reports that a build actually
  // rendered a working preview. Recorded append-only; after the first one, the
  // normal build limit applies (the value guarantee has been satisfied).
  if (body?.event === 'preview_reached') {
    const ok = await recordPreviewReached(owner.email, slug)
    return NextResponse.json({ ok })
  }

  const raw = await getBuildCreditStatus(owner.email, owner.tier)
  // Value guarantee (#310/#311 GR-01/GR-02): credits are recorded at build
  // START, so a founder whose builds all failed before rendering could exhaust
  // the allowance having NEVER seen a working preview. The free tier guarantees
  // one VISIBLE build — never a card wall before the first value moment.
  const status = raw.allowed
    ? raw
    : applyValueGuarantee(raw, await hasReachedPreview(owner.email))
  if (!status.allowed) {
    return NextResponse.json(
      { error: 'build_limit_reached', ...status, tier: owner.tier },
      { status: 402 },
    )
  }

  // #324 GR-15: derive the primitives THIS build composes from the idea, server-side,
  // with the same deterministic function that drives composition. Never trust a
  // client-sent primitives list.
  const idea = typeof body?.idea === 'string' ? body.idea : ''
  const track: 'app' | 'company' = body?.track === 'app' ? 'app' : 'company'
  const primitives = idea ? selectPrimitives(idea, track).names : []
  await recordBuild(owner.email, slug, primitives)

  // Re-read so the client gets the post-record remaining count for its UI.
  const after = await getBuildCreditStatus(owner.email, owner.tier)
  // The bonus this build ACTUALLY added to the runway (0 once the cap is hit, or
  // when metering is unconfigured) — never promise an extension that didn't apply.
  const bonusApplied = Math.max(0, (after.ecosystemBonus ?? 0) - (status.ecosystemBonus ?? 0))
  const composed = countEcosystemPrimitives(primitives, track, idea)
  return NextResponse.json({
    ok: true,
    ...after,
    valueGuarantee: status.valueGuarantee ?? false,
    tier: owner.tier,
    ecosystem: {
      composed,
      bonusEarned: bonusApplied,
      message: bonusApplied > 0 ? ecosystemBonusMessage(composed, bonusApplied) : '',
    },
  })
}
