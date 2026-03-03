/**
 * Activate Design Token API
 *
 * PUT /api/design-tokens/:tokenId/activate - Activate a design token
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import { getDesignToken, setActiveDesignToken } from '@/lib/db/queries'
import { logger } from '@/lib/logger'

export async function PUT(
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

    // Set as active (this will deactivate all other tokens for this user)
    const [updatedToken] = await setActiveDesignToken({ userId, tokenId })

    logger.info('Design token activated', { userId, tokenId })

    return NextResponse.json({
      success: true,
      token: {
        id: updatedToken.id,
        name: updatedToken.name,
        version: updatedToken.version,
        isActive: updatedToken.is_active,
      },
    })
  } catch (error) {
    logger.error('Failed to activate design token', { error })
    return NextResponse.json(
      { error: 'Failed to activate design token' },
      { status: 500 }
    )
  }
}
