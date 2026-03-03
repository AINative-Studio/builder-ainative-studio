import { NextRequest, NextResponse } from 'next/server'
import { handleAlertCheck } from '@/lib/jobs/alerting'
import { logger } from '@/lib/logger'

// This endpoint should be called by a cron job (e.g., Vercel Cron, GitHub Actions, etc.)
// Secure it with a secret token
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('Unauthorized cron request', {
        path: '/api/cron/alerts',
        ip: request.headers.get('x-forwarded-for') || 'unknown',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('Running scheduled alert check')
    const response = await handleAlertCheck()

    // Convert Response to NextResponse
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    logger.error('Cron alert check failed', error as Error)
    return NextResponse.json(
      { error: 'Alert check failed' },
      { status: 500 }
    )
  }
}

// Allow POST as well for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
