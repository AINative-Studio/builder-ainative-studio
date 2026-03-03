/**
 * ZeroDB Proxy API (US-057)
 *
 * /api/zerodb/[...path]
 *
 * Secure proxy to ZeroDB for CRUD operations.
 * Routes requests to ZeroDB MCP server with authentication and rate limiting.
 *
 * Features:
 * - Authentication required (JWT)
 * - Rate limiting (100 req/min per user)
 * - CRUD operations: GET (list), GET (single), POST, PUT, DELETE
 * - Error handling with proper HTTP status codes
 * - Request/response logging
 *
 * Test Coverage Requirement: 90%
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth-jwt'
import { getZeroDBClient, CRUDOperation } from '@/lib/mcp/zerodb-client'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from 'ioredis'
import { logger } from '@/lib/logger'

// Rate limiter for ZeroDB operations
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null

const zerodbRateLimit = redis
  ? new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
      analytics: true,
      prefix: '@ratelimit/zerodb',
    })
  : null

/**
 * GET /api/zerodb/:table - List all records
 * GET /api/zerodb/:table/:id - Get single record
 *
 * US-056: GET operations (list and single)
 * US-057: Authentication required
 * US-057: Rate limiting (100 req/min per user)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    // Verify authentication
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return authResult.response!
    }

    const userId = authResult.userId!

    // Apply rate limiting
    const rateLimitResult = await applyZeroDBRateLimit(userId)
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    // Parse path
    const [table, id] = path
    if (!table) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Table name is required' },
        { status: 400 }
      )
    }

    // Validate table name
    if (!isValidTableName(table)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid table name' },
        { status: 400 }
      )
    }

    const client = getZeroDBClient()

    // Get single record by ID
    if (id) {
      logger.info('ZeroDB GET single record', { table, id, userId })

      const result = await client.executeCRUD({
        operation: 'READ',
        table,
        where: { id },
      })

      if (!result.success) {
        logger.error('ZeroDB GET failed', new Error(result.error), { table, id, userId })
        return NextResponse.json(
          { error: 'Internal Server Error', message: result.error },
          { status: 500 }
        )
      }

      if (!result.data) {
        return NextResponse.json(
          { error: 'Not Found', message: `Record not found` },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        data: result.data,
      })
    }

    // List all records with pagination
    const searchParams = request.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const orderBy = searchParams.get('orderBy')
    const orderDir = (searchParams.get('orderDir') || 'ASC') as 'ASC' | 'DESC'

    logger.info('ZeroDB GET list', { table, limit, offset, userId })

    const result = await client.executeCRUD({
      operation: 'LIST',
      table,
      limit: Math.min(limit, 100), // Max 100 records
      offset,
      orderBy: orderBy ? [{ column: orderBy, direction: orderDir }] : undefined,
    })

    if (!result.success) {
      logger.error('ZeroDB LIST failed', new Error(result.error), { table, userId })
      return NextResponse.json(
        { error: 'Internal Server Error', message: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result.data || [],
      count: result.count || 0,
      pagination: {
        limit,
        offset,
        hasMore: (result.count || 0) > offset + limit,
      },
    })
  } catch (error) {
    logger.error('ZeroDB GET error', error as Error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to fetch data' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/zerodb/:table - Create new record
 *
 * US-056: POST (create) operation
 * US-056: Error handling included
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    // Verify authentication
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return authResult.response!
    }

    const userId = authResult.userId!

    // Apply rate limiting
    const rateLimitResult = await applyZeroDBRateLimit(userId)
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    // Parse path
    const [table] = path
    if (!table || !isValidTableName(table)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid table name' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Request body must be a JSON object' },
        { status: 400 }
      )
    }

    logger.info('ZeroDB POST create', { table, userId })

    const client = getZeroDBClient()
    const result = await client.executeCRUD({
      operation: 'CREATE',
      table,
      data: body,
    })

    if (!result.success) {
      logger.error('ZeroDB CREATE failed', new Error(result.error), { table, userId })
      return NextResponse.json(
        { error: 'Internal Server Error', message: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        message: 'Record created successfully',
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('ZeroDB POST error', error as Error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to create record' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/zerodb/:table/:id - Update record
 *
 * US-056: PUT (update) operation
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    // Verify authentication
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return authResult.response!
    }

    const userId = authResult.userId!

    // Apply rate limiting
    const rateLimitResult = await applyZeroDBRateLimit(userId)
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    // Parse path
    const [table, id] = path
    if (!table || !id || !isValidTableName(table)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid table name or ID' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Request body must be a JSON object' },
        { status: 400 }
      )
    }

    logger.info('ZeroDB PUT update', { table, id, userId })

    const client = getZeroDBClient()
    const result = await client.executeCRUD({
      operation: 'UPDATE',
      table,
      data: body,
      where: { id },
    })

    if (!result.success) {
      logger.error('ZeroDB UPDATE failed', new Error(result.error), { table, id, userId })
      return NextResponse.json(
        { error: 'Internal Server Error', message: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      message: 'Record updated successfully',
    })
  } catch (error) {
    logger.error('ZeroDB PUT error', error as Error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to update record' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/zerodb/:table/:id - Delete record
 *
 * US-056: DELETE (delete) operation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params

    // Verify authentication
    const authResult = await authenticateRequest(request)
    if (!authResult.success) {
      return authResult.response!
    }

    const userId = authResult.userId!

    // Apply rate limiting
    const rateLimitResult = await applyZeroDBRateLimit(userId)
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    // Parse path
    const [table, id] = path
    if (!table || !id || !isValidTableName(table)) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'Invalid table name or ID' },
        { status: 400 }
      )
    }

    logger.info('ZeroDB DELETE', { table, id, userId })

    const client = getZeroDBClient()
    const result = await client.executeCRUD({
      operation: 'DELETE',
      table,
      where: { id },
    })

    if (!result.success) {
      logger.error('ZeroDB DELETE failed', new Error(result.error), { table, id, userId })
      return NextResponse.json(
        { error: 'Internal Server Error', message: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Record deleted successfully',
    })
  } catch (error) {
    logger.error('ZeroDB DELETE error', error as Error)
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Failed to delete record' },
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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    }
  )
}

// Helper functions

interface AuthResult {
  success: boolean
  userId?: string
  response?: NextResponse
}

async function authenticateRequest(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '') || request.cookies.get('auth-token')?.value

  if (!token) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      ),
    }
  }

  const payload = await verifyJWT(token)
  if (!payload) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      ),
    }
  }

  return {
    success: true,
    userId: payload.userId,
  }
}

interface RateLimitResult {
  success: boolean
  response?: NextResponse
}

async function applyZeroDBRateLimit(userId: string): Promise<RateLimitResult> {
  if (!zerodbRateLimit) {
    // Rate limiting disabled (no Redis)
    return { success: true }
  }

  const { success, limit, reset, remaining } = await zerodbRateLimit.limit(
    `zerodb:${userId}`
  )

  if (!success) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000)

    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded for ZeroDB operations',
          limit,
          remaining: 0,
          reset: new Date(reset).toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter.toString(),
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(reset).toISOString(),
          },
        }
      ),
    }
  }

  return { success: true }
}

function isValidTableName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)
}
