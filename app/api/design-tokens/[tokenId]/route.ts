/**
 * Design Token Detail API
 *
 * GET /api/design-tokens/:tokenId - Get specific token
 * PATCH /api/design-tokens/:tokenId - Set as active
 * DELETE /api/design-tokens/:tokenId - Delete token
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import {
  getDesignToken,
  setActiveDesignToken,
  deleteDesignToken,
} from '@/lib/db/queries'
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

    // Get design token
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

    return NextResponse.json({
      success: true,
      token: designToken,
    })
  } catch (error) {
    logger.error('Failed to get design token', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve design token' },
      { status: 500 }
    )
  }
}

export async function PATCH(
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

    // Set as active
    const [updatedToken] = await setActiveDesignToken({ userId, tokenId })

    logger.info('Design token set as active', { userId, tokenId })

    return NextResponse.json({
      success: true,
      token: updatedToken,
    })
  } catch (error) {
    logger.error('Failed to set active design token', { error })
    return NextResponse.json(
      { error: 'Failed to set active design token' },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    // Delete the token
    await deleteDesignToken({ tokenId, userId })

    logger.info('Design token deleted', { userId, tokenId })

    return NextResponse.json({
      success: true,
      message: 'Design token deleted successfully',
    })
  } catch (error) {
    logger.error('Failed to delete design token', { error })
    return NextResponse.json(
      { error: 'Failed to delete design token' },
      { status: 500 }
    )
  }
}
