/**
 * Railway Webhook Handler (US-072)
 * POST /api/webhooks/railway - Handle Railway deployment status updates
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const event = await request.json()
    const { deploymentId, status, url } = event

    await db
      .update(deployments)
      .set({
        status: mapStatus(status),
        url,
        updated_at: new Date(),
      })
      .where(eq(deployments.deployment_id, deploymentId))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Railway webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function mapStatus(status: string): 'pending' | 'building' | 'ready' | 'error' {
  switch (status.toUpperCase()) {
    case 'SUCCESS': case 'ACTIVE': return 'ready'
    case 'BUILDING': case 'DEPLOYING': return 'building'
    case 'FAILED': case 'CRASHED': return 'error'
    default: return 'pending'
  }
}
