/**
 * Evidence Detail API Endpoint
 * GET /api/evidence/[id] - Get specific evidence details
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { evidence } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get evidence
    const [result] = await db.select().from(evidence).where(eq(evidence.id, id)).limit(1)

    if (!result) {
      return NextResponse.json({ error: 'Evidence not found' }, { status: 404 })
    }

    return NextResponse.json({ evidence: result })
  } catch (error) {
    console.error('Evidence detail error:', error)
    return NextResponse.json({ error: 'Failed to get evidence' }, { status: 500 })
  }
}
