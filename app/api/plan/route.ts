import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { getPlanStatus } from '@/lib/ainative/plan'

export const runtime = 'nodejs'

/**
 * GET /api/plan — the signed-in user's AINative tier + workspace/project usage.
 * Mirrors core get_tier_limits so the builder shows the SAME plan rules as
 * ainative.studio (free/hobbyist: 1 workspace, 3 projects). Drives remaining-
 * slot UI and upgrade prompts. Returns hobbyist defaults for a non-AINative
 * session so the UI degrades safely.
 */
export async function GET() {
  const session = await auth()
  const accessToken = (session as any)?.accessToken
  if (!accessToken) {
    return NextResponse.json(
      {
        tier: 'hobbyist',
        signedIn: false,
        workspaces: { used: 0, max: 1, remaining: 1, unlimited: false },
        projects: { used: 0, max: 3, remaining: 3, unlimited: false },
      },
      { status: 200 },
    )
  }
  try {
    const status = await getPlanStatus(accessToken)
    return NextResponse.json({ ...status, signedIn: true })
  } catch (err) {
    console.error('[api/plan] error:', err)
    // Fail safe to the free tier — never over-grant limits on an error.
    return NextResponse.json(
      {
        tier: 'hobbyist',
        signedIn: true,
        workspaces: { used: 0, max: 1, remaining: 1, unlimited: false },
        projects: { used: 0, max: 3, remaining: 3, unlimited: false },
      },
      { status: 200 },
    )
  }
}
