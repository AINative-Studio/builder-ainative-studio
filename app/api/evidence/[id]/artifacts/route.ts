/**
 * Evidence Artifacts API Endpoint
 * GET /api/evidence/[id]/artifacts - List artifacts for evidence
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { artifacts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Get artifacts for this evidence
    const results = await db.select().from(artifacts).where(eq(artifacts.evidence_id, id))

    return NextResponse.json({ artifacts: results })
  } catch (error) {
    console.error('Artifacts list error:', error)
    return NextResponse.json({ error: 'Failed to list artifacts' }, { status: 500 })
  }
}
