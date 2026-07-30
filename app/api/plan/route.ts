import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'

export const runtime = 'nodejs'

/** Safe default: a trialing Hobbyist (the entry tier that replaced free) with
 *  its 1-workspace / 3-project limits. Used when there's no session or on
 *  error, so the UI degrades safely and we never over-grant. */
const HOBBYIST_DEFAULT = {
  tier: 'hobbyist',
  tierLabel: 'Hobbyist',
  status: 'trialing' as const,
  trial: { active: true, endsAt: null, daysLeft: null },
  workspaces: { used: 0, max: 1, remaining: 1, unlimited: false },
  projects: { used: 0, max: 3, remaining: 3, unlimited: false },
}

/**
 * GET /api/plan — the signed-in user's AINative tier, trial state, and
 * workspace/project usage. Mirrors core get_tier_limits so the builder shows
 * the SAME plan rules as ainative.studio (Hobbyist: 1 workspace, 3 projects,
 * 7-day trial). Drives remaining-slot UI, trial countdown, and upgrade prompts.
 */
export async function GET() {
  const session = await auth()
  const accessToken = (session as any)?.accessToken
  if (!accessToken) {
    return NextResponse.json({ ...HOBBYIST_DEFAULT, signedIn: false }, { status: 200 })
  }
  try {
    const status = await getPlanStatus(accessToken)
    return NextResponse.json({ ...status, signedIn: true })
  } catch (err) {
    console.error('[api/plan] error:', err)
    return NextResponse.json({ ...HOBBYIST_DEFAULT, signedIn: true }, { status: 200 })
  }
}
