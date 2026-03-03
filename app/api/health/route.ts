import { NextResponse } from 'next/server'
import { monitoring } from '@/lib/monitoring'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Health check endpoint for production monitoring
 *
 * Returns:
 * - 200: System is healthy
 * - 503: System is degraded or unhealthy
 *
 * Metrics included:
 * - Database connectivity
 * - Redis connectivity (if configured)
 * - Error rates (5min, 1hour, 24hour)
 * - System uptime
 * - Response times
 */
export async function GET() {
  try {
    const health = await monitoring.checkSystemHealth()

    const statusCode = health.status === 'healthy' ? 200 : 503

    logger.info('Health check performed', {
      status: health.status,
      database: health.database.status,
      errors: health.errors,
    })

    return NextResponse.json(
      {
        status: health.status,
        timestamp: new Date().toISOString(),
        uptime: health.uptime,
        checks: {
          database: {
            status: health.database.status,
            responseTime: health.database.responseTime,
          },
          redis: health.redis
            ? {
                status: health.redis.status,
                responseTime: health.redis.responseTime,
              }
            : { status: 'not_configured' },
        },
        errors: health.errors,
        environment: process.env.NODE_ENV,
        version: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      },
      { status: statusCode }
    )
  } catch (error) {
    logger.error('Health check failed', error as Error)

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  }
}
