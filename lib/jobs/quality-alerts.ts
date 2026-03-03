import { eq, and, gte } from 'drizzle-orm'
import db from '@/lib/db/connection'
import { generations, feedback } from '@/lib/db/schema'

// US-018: Quality Degradation Alerts
// Runs every 5 minutes to check for quality degradation

interface QualityMetrics {
  avgRating: number
  firstPassSuccessRate: number
  sampleSize: number
  timeRange: string
}

interface AlertResult {
  alertTriggered: boolean
  reason?: string
  metrics?: QualityMetrics
}

export async function checkQualityDegradation(): Promise<AlertResult> {
  if (!db) {
    console.warn('Database not available for quality check')
    return { alertTriggered: false, reason: 'Database not available' }
  }

  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    // Get all generations from last hour with feedback
    const generationsWithFeedback = await db
      .select({
        generationId: generations.id,
        rating: feedback.rating,
        wasEdited: feedback.was_edited,
      })
      .from(generations)
      .leftJoin(feedback, eq(feedback.generation_id, generations.id))
      .where(gte(generations.created_at, oneHourAgo))

    const withRatings = generationsWithFeedback.filter(g => g.rating !== null)
    const sampleSize = withRatings.length

    if (sampleSize === 0) {
      return { alertTriggered: false, reason: 'No data in last hour' }
    }

    const totalRating = withRatings.reduce((sum, g) => sum + (g.rating || 0), 0)
    const avgRating = totalRating / sampleSize

    const firstPassSuccess = withRatings.filter(
      g => g.rating && g.rating >= 4 && !g.wasEdited
    ).length
    const firstPassSuccessRate = (firstPassSuccess / sampleSize) * 100

    const metrics: QualityMetrics = {
      avgRating,
      firstPassSuccessRate,
      sampleSize,
      timeRange: '1 hour'
    }

    let shouldAlert = false
    let reason = ''

    if (avgRating < 3.5) {
      shouldAlert = true
      reason = `Average rating below 3.5 (${avgRating.toFixed(2)})`
    } else if (firstPassSuccessRate < 40) {
      shouldAlert = true  
      reason = `First-pass success rate below 40% (${firstPassSuccessRate.toFixed(2)}%)`
    }

    if (shouldAlert) {
      await sendQualityAlert(metrics, reason)
      return { alertTriggered: true, reason, metrics }
    }

    return { alertTriggered: false, metrics }
  } catch (error) {
    console.error('Error checking quality degradation:', error)
    return { alertTriggered: false, reason: `Error: ${error}` }
  }
}

async function sendQualityAlert(metrics: QualityMetrics, reason: string) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('No webhook URL configured for quality alerts')
    return
  }

  const message = {
    text: '⚠️ Quality Degradation Alert',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Quality Degradation Detected'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Reason:* ${reason}`
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Avg Rating:*\n${metrics.avgRating.toFixed(2)} / 5.0`
          },
          {
            type: 'mrkdwn',
            text: `*First-Pass Success:*\n${metrics.firstPassSuccessRate.toFixed(2)}%`
          },
          {
            type: 'mrkdwn',
            text: `*Sample Size:*\n${metrics.sampleSize}`
          },
          {
            type: 'mrkdwn',
            text: `*Time Range:*\n${metrics.timeRange}`
          }
        ]
      }
    ]
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    })

    if (!response.ok) {
      console.error('Failed to send quality alert:', await response.text())
    }
  } catch (error) {
    console.error('Error sending quality alert:', error)
  }
}

if (require.main === module) {
  checkQualityDegradation()
    .then(result => {
      console.log('Quality check complete:', result)
      process.exit(0)
    })
    .catch(err => {
      console.error('Quality check failed:', err)
      process.exit(1)
    })
}
