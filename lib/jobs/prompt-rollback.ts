import { eq, and, gte, desc } from 'drizzle-orm'
import db from '@/lib/db/connection'
import { prompt_versions, generations, feedback } from '@/lib/db/schema'
import { deactivatePrompt, activatePrompt } from '@/lib/services/prompt.service'

// US-017: Automatic Prompt Rollback
// Runs every 10 minutes to check if new prompts are underperforming

interface RollbackResult {
  rolledBack: boolean
  currentPromptId?: string
  previousPromptId?: string
  reason?: string
  metrics?: {
    avgRating: number
    sampleSize: number
    hoursActive: number
  }
}

export async function checkAndRollbackPrompt(): Promise<RollbackResult> {
  if (!db) {
    console.warn('Database not available for prompt rollback check')
    return { rolledBack: false, reason: 'Database not available' }
  }

  try {
    // Get all active prompts
    const activePrompts = await db
      .select()
      .from(prompt_versions)
      .where(eq(prompt_versions.is_active, true))

    if (activePrompts.length === 0) {
      return { rolledBack: false, reason: 'No active prompts found' }
    }

    for (const activePrompt of activePrompts) {
      const now = new Date()
      const activatedAt = activePrompt.created_at
      const hoursActive = (now.getTime() - activatedAt.getTime()) / (1000 * 60 * 60)

      // Only check prompts active for less than 6 hours
      if (hoursActive >= 6) {
        continue
      }

      // Get 6 hours ago timestamp
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)

      // Get all generations using this prompt version
      const generationsWithFeedback = await db
        .select({
          generationId: generations.id,
          rating: feedback.rating,
        })
        .from(generations)
        .leftJoin(feedback, eq(feedback.generation_id, generations.id))
        .where(
          and(
            eq(generations.prompt_version_id, activePrompt.id),
            gte(generations.created_at, sixHoursAgo),
          ),
        )

      // Filter to only those with feedback
      const withRatings = generationsWithFeedback.filter(g => g.rating !== null)
      const sampleSize = withRatings.length

      // Need at least 50 samples
      if (sampleSize < 50) {
        console.log(
          `Prompt ${activePrompt.version} only has ${sampleSize} samples, need 50`,
        )
        continue
      }

      // Calculate average rating
      const totalRating = withRatings.reduce((sum, g) => sum + (g.rating || 0), 0)
      const avgRating = totalRating / sampleSize

      // Check if avg rating is below 3.5
      if (avgRating < 3.5) {
        console.warn(
          `⚠️ Prompt ${activePrompt.version} underperforming! ` +
            `Avg rating: ${avgRating.toFixed(2)}, ` +
            `Sample size: ${sampleSize}, ` +
            `Hours active: ${hoursActive.toFixed(2)}`,
        )

        // Get previous active prompt of same type
        const previousPrompts = await db
          .select()
          .from(prompt_versions)
          .where(
            and(
              eq(prompt_versions.type, activePrompt.type),
              eq(prompt_versions.is_active, false),
            ),
          )
          .orderBy(desc(prompt_versions.created_at))
          .limit(1)

        if (previousPrompts.length === 0) {
          console.warn('No previous prompt to rollback to')
          continue
        }

        const previousPrompt = previousPrompts[0]

        // Deactivate current prompt
        await deactivatePrompt(activePrompt.id)

        // Activate previous prompt
        await activatePrompt(previousPrompt.id)

        console.log(
          `✅ Rolled back from ${activePrompt.version} to ${previousPrompt.version}`,
        )

        // Send alert (webhook or notification)
        await sendRollbackAlert({
          currentPromptVersion: activePrompt.version,
          previousPromptVersion: previousPrompt.version,
          avgRating,
          sampleSize,
          hoursActive,
        })

        return {
          rolledBack: true,
          currentPromptId: activePrompt.id,
          previousPromptId: previousPrompt.id,
          reason: `Low average rating: ${avgRating.toFixed(2)}`,
          metrics: {
            avgRating,
            sampleSize,
            hoursActive,
          },
        }
      }
    }

    return { rolledBack: false, reason: 'All prompts performing well' }
  } catch (error) {
    console.error('Error in prompt rollback check:', error)
    return { rolledBack: false, reason: `Error: ${error}` }
  }
}

async function sendRollbackAlert(data: {
  currentPromptVersion: string
  previousPromptVersion: string
  avgRating: number
  sampleSize: number
  hoursActive: number
}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('No webhook URL configured for rollback alerts')
    return
  }

  const message = {
    text: '🔄 Automatic Prompt Rollback Triggered',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔄 Automatic Prompt Rollback',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Current Prompt:*\n${data.currentPromptVersion}`,
          },
          {
            type: 'mrkdwn',
            text: `*Rolled Back To:*\n${data.previousPromptVersion}`,
          },
          {
            type: 'mrkdwn',
            text: `*Avg Rating:*\n${data.avgRating.toFixed(2)} / 5.0`,
          },
          {
            type: 'mrkdwn',
            text: `*Sample Size:*\n${data.sampleSize}`,
          },
          {
            type: 'mrkdwn',
            text: `*Hours Active:*\n${data.hoursActive.toFixed(2)}`,
          },
        ],
      },
    ],
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      console.error('Failed to send rollback alert:', await response.text())
    }
  } catch (error) {
    console.error('Error sending rollback alert:', error)
  }
}

// Run the job (can be triggered by cron or API endpoint)
if (require.main === module) {
  checkAndRollbackPrompt()
    .then(result => {
      console.log('Rollback check complete:', result)
      process.exit(0)
    })
    .catch(err => {
      console.error('Rollback check failed:', err)
      process.exit(1)
    })
}
