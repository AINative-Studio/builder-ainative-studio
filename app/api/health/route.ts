import { NextResponse } from 'next/server'
import { monitoring } from '@/lib/monitoring'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Health check endpoint for production monitoring
 *
 * Liveness check (default): Always returns 200 if the process is running.
 * Readiness check (?ready=1): Returns 503 if dependencies (DB) are down.
 *
 * Railway, uptime monitors, and issue #39 health probes hit this endpoint.
 * A liveness probe must never fail due to a transient DB hiccup.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const readinessCheck = searchParams.get('ready') === '1'

    const health = await monitoring.checkSystemHealth()

    // Liveness: 200 always. Readiness: 503 if unhealthy.
    const statusCode =
      readinessCheck && health.status !== 'healthy' ? 503 : 200

    logger.info('Health check performed', {
      status: health.status,
      database: health.database.status,
      readinessCheck,
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
        version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
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
      { status: 200 }
    )
  }
}
