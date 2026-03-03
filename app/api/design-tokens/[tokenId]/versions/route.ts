/**
 * Design Token Versions API
 *
 * GET /api/design-tokens/:tokenId/versions - Get version history for a design token
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import { getDesignToken } from '@/lib/db/queries'
import { logger } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  { params }: { params: { tokenId: string } }
) {
  try {
    // Verify authentication
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized - please sign in' },
        { status: 401 }
      )
    }

    const userId = user.userId
    const { tokenId } = params

    // Get design token to verify ownership
    const designToken = await getDesignToken(tokenId)

    if (!designToken) {
      return NextResponse.json(
        { error: 'Design token not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (designToken.user_id !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized - not token owner' },
        { status: 403 }
      )
    }

    // For now, return the current version as the only version
    // In a full implementation, you would query a versions table
    const versions = [
      {
        id: designToken.id,
        designTokenId: designToken.id,
        version: designToken.version,
        tokens: designToken.tokens,
        createdAt: designToken.created_at,
        createdBy: designToken.user_id,
      },
    ]

    return NextResponse.json({
      success: true,
      versions,
    })
  } catch (error) {
    logger.error('Failed to get design token versions', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve versions' },
      { status: 500 }
    )
  }
}
