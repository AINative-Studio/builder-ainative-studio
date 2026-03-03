/**
 * Deployments List API (Epic 9)
 * GET /api/deployments - List all deployments for user
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    const userId = session?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const userDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.user_id, userId))
      .orderBy(desc(deployments.created_at))
      .limit(50)

    return NextResponse.json({ deployments: userDeployments })
  } catch (error) {
    console.error('Deployments list error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch deployments' },
      { status: 500 }
    )
  }
}
