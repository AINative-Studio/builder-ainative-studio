/**
 * Netlify Webhook Handler (US-072)
 * POST /api/webhooks/netlify - Handle Netlify deployment status updates
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
    const { id, state, ssl_url } = event

    await db
      .update(deployments)
      .set({
        status: mapStatus(state),
        url: ssl_url,
        updated_at: new Date(),
      })
      .where(eq(deployments.deployment_id, id))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Netlify webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function mapStatus(state: string): 'pending' | 'building' | 'ready' | 'error' {
  switch (state) {
    case 'ready': return 'ready'
    case 'building': case 'processing': return 'building'
    case 'error': return 'error'
    default: return 'pending'
  }
}
