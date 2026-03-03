/**
 * AINative Cloud Webhook Handler (US-072)
 * POST /api/webhooks/ainative - Handle AINative Cloud deployment status updates
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
    const { deploymentId, status, url, provider } = event

    await db
      .update(deployments)
      .set({
        status: mapStatus(status),
        url,
        metadata: { selectedProvider: provider },
        updated_at: new Date(),
      })
      .where(eq(deployments.deployment_id, deploymentId))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('AINative webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function mapStatus(status: string): 'pending' | 'building' | 'ready' | 'error' {
  switch (status.toLowerCase()) {
    case 'ready': case 'deployed': return 'ready'
    case 'building': case 'deploying': return 'building'
    case 'error': case 'failed': return 'error'
    default: return 'pending'
  }
}
