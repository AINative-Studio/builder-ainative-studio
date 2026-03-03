/**
 * Deployment Details API (Epic 9)
 * GET /api/deployments/[id] - Get deployment details
 * DELETE /api/deployments/[id] - Cancel/delete deployment
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { deployments } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const userId = session?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const [deployment] = await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, params.id), eq(deployments.user_id, userId)))
      .limit(1)

    if (!deployment) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })
    }

    return NextResponse.json({ deployment })
  } catch (error) {
    console.error('Deployment fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch deployment' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const userId = session?.userId

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const result = await db
      .delete(deployments)
      .where(and(eq(deployments.id, params.id), eq(deployments.user_id, userId)))
      .returning()

    if (result.length === 0) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Deployment deleted' })
  } catch (error) {
    console.error('Deployment delete error:', error)
    return NextResponse.json({ error: 'Failed to delete deployment' }, { status: 500 })
  }
}
