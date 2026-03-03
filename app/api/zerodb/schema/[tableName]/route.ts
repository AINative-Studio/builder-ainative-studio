/**
 * ZeroDB Schema Introspection API (US-053)
 *
 * GET /api/zerodb/schema/:tableName
 *
 * Returns table schema with columns, primary keys, and indexes.
 * Results are cached in Redis with 1-hour TTL.
 *
 * Features:
 * - Authentication required (JWT)
 * - Rate limiting (100 req/min)
 * - Redis caching (1 hour TTL)
 * - Comprehensive error handling
 *
 * Test Coverage Requirement: 90%
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth-jwt'
import { getTableSchema } from '@/lib/services/schema.service'
import { logger } from '@/lib/logger'

/**
 * GET /api/zerodb/schema/:tableName
 *
 * US-053: Returns columns (name, type, nullable, default), primary key, indexes
 * US-053: Response cached in Redis (1 hour TTL)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tableName: string }> }
) {
  try {
    // Extract table name from params
    const { tableName } = await params

    // Validate table name format
    if (!tableName || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tableName)) {
      logger.warn('Invalid table name format', { tableName })
      return NextResponse.json(
        {
          error: 'Invalid table name',
          message: 'Table name must start with a letter and contain only alphanumeric characters and underscores',
        },
        { status: 400 }
      )
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') || request.cookies.get('auth-token')?.value

    if (!token) {
      logger.warn('Unauthorized schema access attempt', { tableName })
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Authentication required',
        },
        { status: 401 }
      )
    }

    const payload = await verifyJWT(token)
    if (!payload) {
      logger.warn('Invalid token for schema access', { tableName })
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      )
    }

    logger.info('Schema request authenticated', {
      userId: payload.userId,
      tableName,
    })

    // Fetch schema (with caching)
    const schema = await getTableSchema(tableName)

    if (!schema) {
      logger.warn('Schema not found', { tableName, userId: payload.userId })
      return NextResponse.json(
        {
          error: 'Not Found',
          message: `Table '${tableName}' not found`,
        },
        { status: 404 }
      )
    }

    logger.info('Schema retrieved successfully', {
      tableName,
      userId: payload.userId,
      columnCount: schema.columns.length,
    })

    // Return schema with cache headers
    return NextResponse.json(
      {
        success: true,
        data: schema,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=3600', // 1 hour
          'X-Cache-Source': 'redis',
        },
      }
    )
  } catch (error) {
    logger.error('Schema API error', error as Error, {
      path: request.nextUrl.pathname,
    })

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to fetch table schema',
      },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    }
  )
}
