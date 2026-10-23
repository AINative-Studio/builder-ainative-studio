/**
 * Design Token Versioning API (US-025)
 *
 * GET /api/design-tokens/versions
 *
 * Cross-token overview, distinct from GET /api/design-tokens/[tokenId]/versions
 * (that route's per-token history): groups every one of the user's design
 * tokens by name with their version list and optional generation-usage stats.
 *
 * Features:
 * - List all design token versions for a user
 * - Filter by token name (optional)
 * - Sort by version (semver)
 * - Include generation usage statistics
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/design-tokens/auth-helper'
import {
  getDesignTokensByUserId,
  getDesignTokenVersions,
  getGenerationsByDesignToken,
} from '@/lib/db/queries'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    // Verify authentication — resolved via the same next-auth session every
    // other /api/design-tokens/* route uses (#1213). This route previously
    // checked a raw `verifyJWT` bearer/cookie token instead, a DIFFERENT
    // auth scheme from its siblings (getAuthenticatedUser(), session-based).
    // A real signed-in founder's browser only carries the next-auth session
    // cookie, never the separate auth-token JWT cookie, so this route 401'd
    // for every real caller regardless of wiring — fixed before wiring it up.
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized - please sign in' },
        { status: 401 }
      )
    }

    const userId = user.userId

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
    logger.error('Failed to get design token versions', error as Error)
    return NextResponse.json(
      { error: 'Failed to retrieve design token versions' },
      { status: 500 }
    )
  }
}
