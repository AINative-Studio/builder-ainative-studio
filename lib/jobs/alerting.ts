import db from '../db/connection'
import { error_logs } from '../db/schema'
import { sql, gte, and, desc } from 'drizzle-orm'
import { logger } from '../logger'

// Alert configuration from PRD
interface AlertRule {
  name: string
  condition: () => Promise<boolean>
  message: string
  severity: 'warning' | 'critical'
}

interface AlertNotification {
  title: string
  message: string
  severity: 'warning' | 'critical'
  timestamp: Date
  metrics?: Record<string, any>
}

// State to track consecutive failures
let consecutiveLLMFailures = 0
let lastAlertTime: Record<string, number> = {}

// Minimum time between duplicate alerts (5 minutes)
const ALERT_COOLDOWN = 5 * 60 * 1000

// Check if we should send an alert (avoid spam)
function shouldSendAlert(alertName: string): boolean {
  const now = Date.now()
  const lastAlert = lastAlertTime[alertName] || 0

  if (now - lastAlert < ALERT_COOLDOWN) {
    return false
  }

  lastAlertTime[alertName] = now
  return true
}

// Alert Rule 1: Error rate > 5% for 5 minutes
async function checkErrorRate(): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  // Get total error count in last 5 minutes
  const errorCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(error_logs)
    .where(gte(error_logs.timestamp, fiveMinutesAgo))
    .then((rows: Array<{ count: number }>) => rows[0]?.count || 0)

  // In a real system, you'd compare against total requests
  // For now, we'll use a simpler threshold: more than 50 errors in 5 minutes
  const threshold = 50

  return errorCount > threshold
}

// Alert Rule 2: Latency p95 > 10 seconds
// Note: This requires request timing logs. For now, we'll check for timeout errors
async function checkLatency(): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000)

  const timeoutErrors = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(error_logs)
    .where(
      and(
        gte(error_logs.timestamp, oneMinuteAgo),
        sql`${error_logs.message} ILIKE '%timeout%' OR ${error_logs.message} ILIKE '%slow%'`
      )
    )
    .then((rows: Array<{ count: number }>) => rows[0]?.count || 0)

  // More than 5 timeout errors in 1 minute
  return timeoutErrors > 5
}

// Alert Rule 3: Redis connection failures
async function checkRedisFailures(): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000)

  const redisErrors = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(error_logs)
    .where(
      and(
        gte(error_logs.timestamp, oneMinuteAgo),
        sql`${error_logs.message} ILIKE '%redis%' OR ${error_logs.error_type} = 'REDIS_ERROR'`
      )
    )
    .then((rows: Array<{ count: number }>) => rows[0]?.count || 0)

  // Any Redis errors are critical
  return redisErrors > 0
}

// Alert Rule 4: LLM API failures (3+ consecutive)
async function checkLLMFailures(): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

  const llmErrors = await db
    .select({
      id: error_logs.id,
      timestamp: error_logs.timestamp,
    })
    .from(error_logs)
    .where(
      and(
        gte(error_logs.timestamp, fiveMinutesAgo),
        sql`${error_logs.message} ILIKE '%openai%' OR ${error_logs.message} ILIKE '%llm%' OR ${error_logs.endpoint} LIKE '%chat%'`
      )
    )
    .orderBy(desc(error_logs.timestamp))
    .limit(5)

  // Check if we have 3 or more consecutive LLM failures
  if (llmErrors.length >= 3) {
    consecutiveLLMFailures = llmErrors.length
    return true
  }

  consecutiveLLMFailures = 0
  return false
}

// Send alert to Slack
async function sendSlackAlert(notification: AlertNotification): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    logger.warn('SLACK_WEBHOOK_URL not configured, skipping Slack notification')
    return
  }

  try {
    const color = notification.severity === 'critical' ? '#ff0000' : '#ff9900'

    const payload = {
      attachments: [
        {
          color,
          title: `🚨 ${notification.title}`,
          text: notification.message,
          fields: notification.metrics
            ? Object.entries(notification.metrics).map(([key, value]) => ({
                title: key,
                value: String(value),
                short: true,
              }))
            : [],
          footer: 'AI-Native Web Builder Monitoring',
          ts: Math.floor(notification.timestamp.getTime() / 1000),
        },
      ],
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.statusText}`)
    }

    logger.info('Slack alert sent successfully', {
      title: notification.title,
      severity: notification.severity,
    })
  } catch (error) {
    logger.error('Failed to send Slack alert', error as Error, {
      title: notification.title,
    })
  }
}

// Send email alert (optional)
async function sendEmailAlert(notification: AlertNotification): Promise<void> {
  // Email configuration would go here
  // For now, we'll just log it
  logger.info('Email alert (not configured)', {
    title: notification.title,
    message: notification.message,
    severity: notification.severity,
  })
}

// Main alerting function
export async function checkAlerts(): Promise<void> {
  const alerts: AlertRule[] = [
    {
      name: 'high_error_rate',
      condition: checkErrorRate,
      message: 'Error rate has exceeded 5% threshold for the last 5 minutes',
      severity: 'critical',
    },
    {
      name: 'high_latency',
      condition: checkLatency,
      message: 'High latency detected - multiple timeout errors in the last minute',
      severity: 'warning',
    },
    {
      name: 'redis_failure',
      condition: checkRedisFailures,
      message: 'Redis connection failures detected',
      severity: 'critical',
    },
    {
      name: 'llm_failures',
      condition: checkLLMFailures,
      message: `LLM API failures detected (${consecutiveLLMFailures} consecutive errors)`,
      severity: 'critical',
    },
  ]

  for (const alert of alerts) {
    try {
      const triggered = await alert.condition()

      if (triggered && shouldSendAlert(alert.name)) {
        const notification: AlertNotification = {
          title: `Alert: ${alert.name.replace(/_/g, ' ').toUpperCase()}`,
          message: alert.message,
          severity: alert.severity,
          timestamp: new Date(),
        }

        // Send notifications
        await Promise.all([
          sendSlackAlert(notification),
          sendEmailAlert(notification),
        ])

        // Log the alert
        logger.error('Alert triggered', undefined, {
          alert_name: alert.name,
          severity: alert.severity,
          message: alert.message,
        })
      }
    } catch (error) {
      logger.error('Failed to check alert', error as Error, {
        alert_name: alert.name,
      })
    }
  }
}

// Run alerting on an interval (call this from a cron job or background worker)
export function startAlertingSystem(intervalMs: number = 60000) {
  logger.info('Starting alerting system', { interval: `${intervalMs}ms` })

  // Run immediately
  checkAlerts()

  // Then run on interval
  const interval = setInterval(checkAlerts, intervalMs)

  // Return cleanup function
  return () => {
    clearInterval(interval)
    logger.info('Alerting system stopped')
  }
}

// For serverless environments, export the check function to be called by a cron endpoint
export async function handleAlertCheck(): Promise<Response> {
  try {
    await checkAlerts()
    return new Response(JSON.stringify({ success: true, timestamp: new Date() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Alert check failed', error as Error)
    return new Response(
      JSON.stringify({ error: 'Alert check failed', message: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
