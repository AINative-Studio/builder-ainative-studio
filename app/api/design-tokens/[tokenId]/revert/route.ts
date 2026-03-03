/**
 * Revert Design Token Version API
 *
 * POST /api/design-tokens/:tokenId/revert - Revert to a previous version
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import { getDesignToken, createDesignToken } from '@/lib/db/queries'
import { logger } from '@/lib/logger'

interface RevertRequest {
  versionId: string
}

export async function POST(
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

    // Parse request body
    const body = await req.json() as RevertRequest

    if (!body.versionId) {
      return NextResponse.json(
        { error: 'Missing required field: versionId' },
        { status: 400 }
      )
    }

    // Get the version to revert to
    const versionToken = await getDesignToken(body.versionId)

    if (!versionToken) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (versionToken.user_id !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized - not token owner' },
        { status: 403 }
      )
    }

    // Increment version number
    const versionParts = versionToken.version.split('.')
    const newPatch = parseInt(versionParts[2] || '0') + 1
    const newVersion = `${versionParts[0]}.${versionParts[1]}.${newPatch}`

    // Create new version with old tokens
    const [newToken] = await createDesignToken({
      userId,
      name: versionToken.name,
      tokens: versionToken.tokens,
      version: newVersion,
      isActive: versionToken.is_active,
    })

    logger.info('Design token reverted', {
      userId,
      originalTokenId: tokenId,
      versionId: body.versionId,
      newTokenId: newToken.id,
      newVersion,
    })

    return NextResponse.json({
      success: true,
      token: {
        id: newToken.id,
        name: newToken.name,
        version: newToken.version,
        isActive: newToken.is_active,
        createdAt: newToken.created_at,
      },
    })
  } catch (error) {
    logger.error('Failed to revert design token', { error })
    return NextResponse.json(
      { error: 'Failed to revert design token' },
      { status: 500 }
    )
  }
}
