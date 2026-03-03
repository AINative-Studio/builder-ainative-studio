import { eq, and, gte, lte, sql, desc, asc } from 'drizzle-orm'
import db from '@/lib/db/connection'
import { generations, feedback, prompt_versions } from '@/lib/db/schema'
import { cacheGet, cacheSet, cacheDeletePattern } from '@/lib/redis'

export interface GenerationData {
  chatId: string
  userId: string
  prompt: string
  generatedCode: string
  promptVersionId?: string | null
  model: string
  templateUsed?: string | null
  generationTimeMs: number
}

export interface FeedbackData {
  generationId: string
  rating: number
  feedbackText?: string
  wasEdited: boolean
  iterations: number
  editChangesSummary?: {
    linesAdded?: number
    linesRemoved?: number
    componentsChanged?: string[]
    styleChanges?: string[]
  }
}

export interface InsightsQuery {
  timeRange: '1d' | '7d' | '30d'
  groupBy?: 'promptVersion' | 'model' | 'template' | 'day' | 'week' | 'month'
  promptVersionId?: string
}

export interface InsightsResponse {
  summary: {
    avgRating: number
    totalGenerations: number
    firstPassSuccessRate: number
    editRate: number
    avgGenerationTimeMs: number
    p50LatencyMs: number
    p95LatencyMs: number
    p99LatencyMs: number
  }
  breakdown: Array<{
    key: string
    label: string
    avgRating: number
    count: number
    firstPassSuccessRate: number
    editRate: number
    avgGenerationTimeMs: number
  }>
  topEditPatterns?: Array<{
    pattern: string
    count: number
    percentage: number
  }>
}

// Log a new generation
export async function logGeneration(data: GenerationData): Promise<string> {
  if (!db) {
    throw new Error('Database not available')
  }

  const [result] = await db
    .insert(generations)
    .values({
      chat_id: data.chatId,
      user_id: data.userId,
      prompt: data.prompt,
      generated_code: data.generatedCode,
      prompt_version_id: data.promptVersionId || null,
      model: data.model,
      template_used: data.templateUsed || null,
      generation_time_ms: data.generationTimeMs,
    })
    .returning({ id: generations.id })

  // Invalidate insights cache
  await cacheDeletePattern('insights:*')

  return result.id
}

// Submit user feedback
export async function submitFeedback(data: FeedbackData): Promise<string> {
  if (!db) {
    throw new Error('Database not available')
  }

  try {
    // Verify generation exists
    const generation = await db
      .select()
      .from(generations)
      .where(eq(generations.id, data.generationId))
      .limit(1)

    if (!generation || generation.length === 0) {
      throw new Error('Generation not found')
    }

    const [result] = await db
      .insert(feedback)
      .values({
        generation_id: data.generationId,
        rating: data.rating,
        feedback_text: data.feedbackText || null,
        was_edited: data.wasEdited,
        iterations: data.iterations,
        edit_changes_summary: data.editChangesSummary || null,
      })
      .returning({ id: feedback.id })

    // Invalidate insights cache
    await cacheDeletePattern('insights:*')

    return result.id
  } catch (error) {
    // Table doesn't exist in AINative database - log warning and return placeholder
    console.warn('generations/feedback table not found, feedback not stored', {
      generationId: data.generationId,
      error
    })
    // Return a placeholder ID so the UI doesn't error
    return 'feedback-placeholder'
  }
}

// Get insights with caching
export async function getInsights(
  query: InsightsQuery,
): Promise<InsightsResponse> {
  if (!db) {
    throw new Error('Database not available')
  }

  // Create cache key
  const cacheKey = `insights:${query.timeRange}:${query.groupBy || 'none'}:${query.promptVersionId || 'all'}`

  // Try to get from cache
  const cached = await cacheGet<InsightsResponse>(cacheKey)
  if (cached) {
    return cached
  }

  // Calculate date range
  const now = new Date()
  const startDate = new Date()
  switch (query.timeRange) {
    case '1d':
      startDate.setDate(now.getDate() - 1)
      break
    case '7d':
      startDate.setDate(now.getDate() - 7)
      break
    case '30d':
      startDate.setDate(now.getDate() - 30)
      break
  }

  // Build base query
  let baseQuery = db
    .select({
      generationId: generations.id,
      promptVersionId: generations.prompt_version_id,
      model: generations.model,
      templateUsed: generations.template_used,
      generationTimeMs: generations.generation_time_ms,
      createdAt: generations.created_at,
      rating: feedback.rating,
      wasEdited: feedback.was_edited,
      editChangesSummary: feedback.edit_changes_summary,
    })
    .from(generations)
    .leftJoin(feedback, eq(feedback.generation_id, generations.id))
    .where(gte(generations.created_at, startDate))

  if (query.promptVersionId) {
    baseQuery = baseQuery.where(
      eq(generations.prompt_version_id, query.promptVersionId),
    )
  }

  const results = await baseQuery

  // Calculate summary metrics
  const totalGenerations = results.length
  const ratingsWithFeedback = results.filter((r) => r.rating !== null)
  const avgRating =
    ratingsWithFeedback.length > 0
      ? ratingsWithFeedback.reduce((sum, r) => sum + (r.rating || 0), 0) /
        ratingsWithFeedback.length
      : 0

  const firstPassSuccess = results.filter(
    (r) => r.rating && r.rating >= 4 && !r.wasEdited,
  ).length
  const firstPassSuccessRate =
    totalGenerations > 0 ? (firstPassSuccess / totalGenerations) * 100 : 0

  const editedCount = results.filter((r) => r.wasEdited).length
  const editRate = totalGenerations > 0 ? (editedCount / totalGenerations) * 100 : 0

  const avgGenerationTimeMs =
    results.reduce((sum, r) => sum + r.generationTimeMs, 0) / totalGenerations || 0

  // Calculate latency percentiles
  const sortedLatencies = results
    .map((r) => r.generationTimeMs)
    .sort((a, b) => a - b)
  const p50Index = Math.floor(sortedLatencies.length * 0.5)
  const p95Index = Math.floor(sortedLatencies.length * 0.95)
  const p99Index = Math.floor(sortedLatencies.length * 0.99)

  const p50LatencyMs = sortedLatencies[p50Index] || 0
  const p95LatencyMs = sortedLatencies[p95Index] || 0
  const p99LatencyMs = sortedLatencies[p99Index] || 0

  // Calculate breakdown if groupBy is specified
  const breakdown: InsightsResponse['breakdown'] = []
  if (query.groupBy) {
    const grouped = new Map<string, typeof results>()

    results.forEach((result) => {
      let key = ''
      let label = ''

      switch (query.groupBy) {
        case 'promptVersion':
          key = result.promptVersionId || 'unknown'
          label = result.promptVersionId || 'Unknown Version'
          break
        case 'model':
          key = result.model
          label = result.model
          break
        case 'template':
          key = result.templateUsed || 'none'
          label = result.templateUsed || 'No Template'
          break
        case 'day':
        case 'week':
        case 'month':
          const date = new Date(result.createdAt)
          if (query.groupBy === 'day') {
            key = date.toISOString().split('T')[0]
            label = date.toLocaleDateString()
          } else if (query.groupBy === 'week') {
            const weekStart = new Date(date)
            weekStart.setDate(date.getDate() - date.getDay())
            key = weekStart.toISOString().split('T')[0]
            label = `Week of ${weekStart.toLocaleDateString()}`
          } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            label = date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
            })
          }
          break
      }

      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push(result)
    })

    grouped.forEach((items, key) => {
      const ratingsWithFeedback = items.filter((r) => r.rating !== null)
      const groupAvgRating =
        ratingsWithFeedback.length > 0
          ? ratingsWithFeedback.reduce((sum, r) => sum + (r.rating || 0), 0) /
            ratingsWithFeedback.length
          : 0

      const groupFirstPassSuccess = items.filter(
        (r) => r.rating && r.rating >= 4 && !r.wasEdited,
      ).length
      const groupFirstPassRate =
        items.length > 0 ? (groupFirstPassSuccess / items.length) * 100 : 0

      const groupEditedCount = items.filter((r) => r.wasEdited).length
      const groupEditRate =
        items.length > 0 ? (groupEditedCount / items.length) * 100 : 0

      const groupAvgTime =
        items.reduce((sum, r) => sum + r.generationTimeMs, 0) / items.length

      breakdown.push({
        key,
        label: grouped.get(key)![0]?.promptVersionId || key,
        avgRating: groupAvgRating,
        count: items.length,
        firstPassSuccessRate: groupFirstPassRate,
        editRate: groupEditRate,
        avgGenerationTimeMs: groupAvgTime,
      })
    })
  }

  // Analyze edit patterns
  const topEditPatterns: InsightsResponse['topEditPatterns'] = []
  const editPatterns = new Map<string, number>()

  results.forEach((result) => {
    if (result.editChangesSummary && typeof result.editChangesSummary === 'object') {
      const summary = result.editChangesSummary as any

      if (summary.componentsChanged && Array.isArray(summary.componentsChanged)) {
        summary.componentsChanged.forEach((component: string) => {
          const pattern = `Component: ${component}`
          editPatterns.set(pattern, (editPatterns.get(pattern) || 0) + 1)
        })
      }

      if (summary.styleChanges && Array.isArray(summary.styleChanges)) {
        summary.styleChanges.forEach((style: string) => {
          const pattern = `Style: ${style}`
          editPatterns.set(pattern, (editPatterns.get(pattern) || 0) + 1)
        })
      }

      if (summary.linesAdded && summary.linesAdded > 10) {
        const pattern = 'Large additions (>10 lines)'
        editPatterns.set(pattern, (editPatterns.get(pattern) || 0) + 1)
      }

      if (summary.linesRemoved && summary.linesRemoved > 10) {
        const pattern = 'Large deletions (>10 lines)'
        editPatterns.set(pattern, (editPatterns.get(pattern) || 0) + 1)
      }
    }
  })

  // Sort and get top 10 patterns
  const totalEdits = Array.from(editPatterns.values()).reduce(
    (sum, count) => sum + count,
    0,
  )
  Array.from(editPatterns.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([pattern, count]) => {
      topEditPatterns.push({
        pattern,
        count,
        percentage: totalEdits > 0 ? (count / totalEdits) * 100 : 0,
      })
    })

  const response: InsightsResponse = {
    summary: {
      avgRating,
      totalGenerations,
      firstPassSuccessRate,
      editRate,
      avgGenerationTimeMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
    },
    breakdown,
    topEditPatterns,
  }

  // Cache for 5 minutes
  await cacheSet(cacheKey, response, 300)

  return response
}

// Get active prompt version for A/B testing
export async function getActivePromptVersion(
  type: string,
): Promise<{ id: string; content: string; version: string } | null> {
  if (!db) {
    throw new Error('Database not available')
  }

  try {
    const activePrompts = await db
      .select()
      .from(prompt_versions)
      .where(
        and(
          eq(prompt_versions.type, type),
          eq(prompt_versions.is_active, true),
        ),
      )

    if (activePrompts.length === 0) {
      return null
    }

    // If multiple active prompts (A/B testing), select randomly based on percentage
    if (activePrompts.length > 1) {
      const random = Math.random() * 100
    let cumulative = 0

    for (const prompt of activePrompts) {
      cumulative += prompt.ab_test_percentage || 0
      if (random <= cumulative) {
        return {
          id: prompt.id,
          content: prompt.content,
          version: prompt.version,
        }
      }
    }
    }

    // Return the only active prompt or first one if percentages don't add up
    return {
      id: activePrompts[0].id,
      content: activePrompts[0].content,
      version: activePrompts[0].version,
    }
  } catch (error) {
    // Table/column doesn't exist in AINative database - return null to use default
    console.warn('prompt_versions table/columns not found, using default prompt', { type, error })
    return null
  }
}
