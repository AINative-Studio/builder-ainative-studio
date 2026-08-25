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
 */
import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'
import { getBuildCreditStatus, recordBuild } from '@/lib/build/build-credits'

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

  const status = await getBuildCreditStatus(owner.email, owner.tier)
  if (!status.allowed) {
    return NextResponse.json(
      { error: 'build_limit_reached', ...status, tier: owner.tier },
      { status: 402 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const slug = typeof body?.slug === 'string' ? body.slug : undefined
  await recordBuild(owner.email, slug)

  // Re-read so the client gets the post-record remaining count for its UI.
  const after = await getBuildCreditStatus(owner.email, owner.tier)
  return NextResponse.json({ ok: true, ...after, tier: owner.tier })
}
