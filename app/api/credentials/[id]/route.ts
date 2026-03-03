/**
 * Credential Management API (US-071)
 * PUT /api/credentials/[id] - Update credentials
 * DELETE /api/credentials/[id] - Delete credentials
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { deleteCredentials, Platform } from '@/lib/services/credentials.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

    const platform = params.id as Platform
    const deleted = await deleteCredentials(userId, platform)

    if (!deleted) {
      return NextResponse.json({ error: 'Credentials not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'Credentials deleted' })
  } catch (error) {
    console.error('Credentials delete error:', error)
    return NextResponse.json({ error: 'Failed to delete credentials' }, { status: 500 })
  }
}
