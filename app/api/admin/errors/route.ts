import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db/connection'
import { error_logs } from '@/lib/db/schema'
import { desc, sql, and, gte, eq } from 'drizzle-orm'
import { getToken } from 'next-auth/jwt'
import { withErrorHandler, AuthenticationError, AuthorizationError } from '@/lib/middleware/error-handler'

// Admin check - you can customize this based on your auth setup
async function requireAdmin(request: NextRequest): Promise<void> {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  })

  if (!token) {
    throw new AuthenticationError()
  }

  // Check if user is admin (customize based on your user model)
  // For now, we'll check if the email matches an admin pattern or specific email
  const isAdmin = token.email?.includes('admin') ||
                  token.email === process.env.ADMIN_EMAIL

  if (!isAdmin) {
    throw new AuthorizationError('Admin access required')
  }
}

async function getErrorsHandler(request: NextRequest) {
  await requireAdmin(request)

  const { searchParams } = request.nextUrl
  const timeRange = searchParams.get('timeRange') || '24h'
  const errorType = searchParams.get('errorType')
  const endpoint = searchParams.get('endpoint')
  const limit = parseInt(searchParams.get('limit') || '100')

  // Calculate time threshold based on range
  const now = new Date()
  let startTime = new Date()

  switch (timeRange) {
    case '1h':
      startTime = new Date(now.getTime() - 60 * 60 * 1000)
      break
    case '6h':
      startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000)
      break
    case '24h':
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    default:
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  }

  // Build filters
  const filters = [gte(error_logs.timestamp, startTime)]
  if (errorType) {
    filters.push(eq(error_logs.error_type, errorType))
  }
  if (endpoint) {
    filters.push(eq(error_logs.endpoint, endpoint))
  }

  // Fetch error logs
  const errors = await db
    .select()
    .from(error_logs)
    .where(and(...filters))
    .orderBy(desc(error_logs.timestamp))
    .limit(limit)

  // Get error statistics grouped by type
  const errorsByType = await db
    .select({
      error_type: error_logs.error_type,
      count: sql<number>`count(*)::int`,
      last_occurrence: sql<Date>`max(${error_logs.timestamp})`,
    })
    .from(error_logs)
    .where(gte(error_logs.timestamp, startTime))
    .groupBy(error_logs.error_type)
    .orderBy(desc(sql`count(*)`))

  // Get error statistics grouped by endpoint
  const errorsByEndpoint = await db
    .select({
      endpoint: error_logs.endpoint,
      count: sql<number>`count(*)::int`,
      last_occurrence: sql<Date>`max(${error_logs.timestamp})`,
    })
    .from(error_logs)
    .where(gte(error_logs.timestamp, startTime))
    .groupBy(error_logs.endpoint)
    .orderBy(desc(sql`count(*)`))

  // Get error rate by hour for charting
  const errorRateByHour = await db
    .select({
      hour: sql<string>`date_trunc('hour', ${error_logs.timestamp})`,
      count: sql<number>`count(*)::int`,
      error_count: sql<number>`count(*) filter (where ${error_logs.level} = 'error')::int`,
      fatal_count: sql<number>`count(*) filter (where ${error_logs.level} = 'fatal')::int`,
    })
    .from(error_logs)
    .where(gte(error_logs.timestamp, startTime))
    .groupBy(sql`date_trunc('hour', ${error_logs.timestamp})`)
    .orderBy(sql`date_trunc('hour', ${error_logs.timestamp})`)

  // Calculate error rate (errors per total requests - would need request logs for accurate rate)
  const totalErrors = errors.length
  const errorRate = totalErrors // Simplified - in production, calculate as percentage of total requests

  return NextResponse.json({
    errors,
    statistics: {
      total_errors: totalErrors,
      error_rate: errorRate,
      errors_by_type: errorsByType,
      errors_by_endpoint: errorsByEndpoint,
      error_rate_by_hour: errorRateByHour,
    },
    filters: {
      timeRange,
      errorType,
      endpoint,
      startTime,
      endTime: now,
    },
  })
}

export const GET = withErrorHandler(getErrorsHandler)
