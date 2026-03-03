/**
 * Design Tokens List API
 *
 * GET /api/design-tokens - List all user's design tokens
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import { getDesignTokensByUserId } from '@/lib/db/queries'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
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

    // Get all design tokens for user
    const tokens = await getDesignTokensByUserId(userId)

    // Transform to match our types
    const transformedTokens = tokens.map(token => ({
      id: token.id,
      userId: token.user_id,
      name: token.name,
      isActive: token.is_active,
      currentVersion: token.version,
      tokens: token.tokens,
      createdAt: token.created_at,
      updatedAt: token.updated_at || token.created_at,
    }))

    return NextResponse.json({
      success: true,
      tokens: transformedTokens,
    })
  } catch (error) {
    logger.error('Failed to list design tokens', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve design tokens' },
      { status: 500 }
    )
  }
}
