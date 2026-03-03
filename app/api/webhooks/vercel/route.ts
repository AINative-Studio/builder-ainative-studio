/**
 * Vercel Webhook Handler (US-072)
 * POST /api/webhooks/vercel - Handle Vercel deployment status updates
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createHmac, timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.VERCEL_WEBHOOK_SECRET
  if (!secret) return false
  
  const hmac = createHmac('sha256', secret)
  const digest = hmac.update(payload).digest('hex')
  
  return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-vercel-signature')
    const payload = await request.text()

    if (!signature || !verifySignature(payload, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(payload)
    const { deploymentId, readyState, url } = event

    await db
      .update(deployments)
      .set({
        status: mapStatus(readyState),
        url: url ? `https://${url}` : undefined,
        updated_at: new Date(),
      })
      .where(eq(deployments.deployment_id, deploymentId))

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Vercel webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function mapStatus(readyState: string): 'pending' | 'building' | 'ready' | 'error' {
  switch (readyState) {
    case 'READY': return 'ready'
    case 'BUILDING': case 'QUEUED': return 'building'
    case 'ERROR': case 'CANCELED': return 'error'
    default: return 'pending'
  }
}
