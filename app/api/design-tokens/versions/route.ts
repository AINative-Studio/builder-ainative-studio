/**
 * Design Token Versioning API (US-025)
 *
 * GET /api/design-tokens/versions
 *
 * Features:
 * - List all design token versions for a user
 * - Filter by token name (optional)
 * - Sort by version (semver)
 * - Include generation usage statistics
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-jwt'
import {
  getDesignTokensByUserId,
  getDesignTokenVersions,
  getGenerationsByDesignToken,
} from '@/lib/db/queries'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    // Verify authentication
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized - missing token' },
        { status: 401 }
      )
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json(
        { error: 'Unauthorized - invalid token' },
        { status: 401 }
      )
    }

    const userId = payload.userId as string

    // Get query parameters
    const searchParams = req.nextUrl.searchParams
    const name = searchParams.get('name')
    const includeStats = searchParams.get('includeStats') === 'true'

    // Get design tokens
    let tokens
    if (name) {
      tokens = await getDesignTokenVersions({ userId, name })
    } else {
      tokens = await getDesignTokensByUserId(userId)
    }

    // Group by name
    const groupedByName = tokens.reduce((acc, token) => {
      if (!acc[token.name]) {
        acc[token.name] = []
      }
      acc[token.name].push(token)
      return acc
    }, {} as Record<string, typeof tokens>)

    // Format response
    const response = await Promise.all(
      Object.entries(groupedByName).map(async ([tokenName, versions]) => {
        const versionsWithStats = await Promise.all(
          versions.map(async (version) => {
            let generationCount = 0

            if (includeStats) {
              const generations = await getGenerationsByDesignToken(version.id)
              generationCount = generations.length
            }

            return {
              id: version.id,
              version: version.version,
              isActive: version.is_active,
              createdAt: version.created_at,
              updatedAt: version.updated_at,
              generationCount,
            }
          })
        )

        return {
          name: tokenName,
          versions: versionsWithStats,
          totalVersions: versions.length,
          activeVersion: versions.find((v) => v.is_active)?.version || null,
        }
      })
    )

    logger.info('Retrieved design token versions', {
      userId,
      count: tokens.length,
      groupCount: Object.keys(groupedByName).length,
    })

    return NextResponse.json({
      success: true,
      tokens: response,
    })
  } catch (error) {
    logger.error('Failed to get design token versions', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve design token versions' },
      { status: 500 }
    )
  }
}
