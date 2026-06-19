/**
 * ZeroDB RLHF Service
 *
 * Reads/writes RLHF data from ZeroDB instead of Drizzle/Postgres.
 * Used by rlhf.service.ts for submitFeedback and getInsights.
 *
 * Refs #42
 */

const API_URL = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '29e8754c-c67d-4a74-9167-a069d87ab1aa'

const TRAINING_TABLE = 'rlhf_training_data'
const FEEDBACK_TABLE = 'rlhf_feedback'

function zerodbUrl(table: string, suffix = 'rows') {
  return `${API_URL}/api/v1/projects/${PROJECT_ID}/database/tables/${table}/${suffix}`
}

function headers() {
  return { 'x-api-key': API_KEY, 'Content-Type': 'application/json' }
}

async function zerodbFetch(url: string, options: RequestInit): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[ZeroDB-RLHF] ${options.method} ${res.status}: ${text.substring(0, 100)}`)
      return null
    }
    return res.json()
  } catch (err: any) {
    clearTimeout(timer)
    console.warn(`[ZeroDB-RLHF] fetch error: ${err?.name || err?.message || 'unknown'}`)
    return null
  }
}

// ============================================================
// INSIGHTS — reads from rlhf_training_data + rlhf_feedback
// ============================================================

export interface ZeroDBInsightsQuery {
  timeRange: '1d' | '7d' | '30d'
  groupBy?: 'promptVersion' | 'model' | 'template' | 'day' | 'week' | 'month'
  promptVersionId?: string
}

export interface ZeroDBInsightsResponse {
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

export async function getInsightsFromZeroDB(
  query: ZeroDBInsightsQuery,
): Promise<ZeroDBInsightsResponse> {
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

  // Fetch training data rows from ZeroDB
  const trainingResult = await zerodbFetch(zerodbUrl(TRAINING_TABLE, 'rows') + '?limit=500', {
    method: 'GET',
    headers: headers(),
  })

  const allRows = (trainingResult?.data || []).map((r: any) => r.row_data || r)

  // Filter by date range client-side
  const rows = allRows.filter((r: any) => {
    const createdAt = r.created_at ? new Date(r.created_at) : null
    return createdAt && createdAt >= startDate
  })

  // Also fetch feedback rows to get ratings
  const feedbackResult = await zerodbFetch(zerodbUrl(FEEDBACK_TABLE, 'rows') + '?limit=500', {
    method: 'GET',
    headers: headers(),
  })
  const feedbackRows = (feedbackResult?.data || []).map((r: any) => r.row_data || r)

  // Build a map of chat_id -> feedback rating
  const ratingMap = new Map<string, number>()
  feedbackRows.forEach((f: any) => {
    if (f.chat_id && f.rating) {
      ratingMap.set(f.chat_id, f.rating)
    }
  })

  // Calculate summary metrics
  const totalGenerations = rows.length
  if (totalGenerations === 0) {
    return {
      summary: {
        avgRating: 0,
        totalGenerations: 0,
        firstPassSuccessRate: 0,
        editRate: 0,
        avgGenerationTimeMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
      },
      breakdown: [],
      topEditPatterns: [],
    }
  }

  // Merge ratings from feedback table
  const rowsWithRatings = rows.map((r: any) => ({
    ...r,
    rating: ratingMap.get(r.chat_id) || null,
  }))

  const ratingsWithFeedback = rowsWithRatings.filter((r: any) => r.rating !== null)
  const avgRating =
    ratingsWithFeedback.length > 0
      ? ratingsWithFeedback.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) /
        ratingsWithFeedback.length
      : 0

  const firstPassSuccess = rowsWithRatings.filter(
    (r: any) => r.rating && r.rating >= 4 && r.validation_valid !== false,
  ).length
  const firstPassSuccessRate =
    totalGenerations > 0 ? (firstPassSuccess / totalGenerations) * 100 : 0

  // Edit rate: rows that had retry_attempted
  const editedCount = rows.filter((r: any) => r.retry_attempted).length
  const editRate = totalGenerations > 0 ? (editedCount / totalGenerations) * 100 : 0

  const latencies = rows
    .map((r: any) => r.generation_time_ms || 0)
    .filter((t: number) => t > 0)
  const avgGenerationTimeMs =
    latencies.length > 0 ? latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length : 0

  // Calculate latency percentiles
  const sortedLatencies = [...latencies].sort((a: number, b: number) => a - b)
  const p50Index = Math.floor(sortedLatencies.length * 0.5)
  const p95Index = Math.floor(sortedLatencies.length * 0.95)
  const p99Index = Math.floor(sortedLatencies.length * 0.99)

  const p50LatencyMs = sortedLatencies[p50Index] || 0
  const p95LatencyMs = sortedLatencies[p95Index] || 0
  const p99LatencyMs = sortedLatencies[p99Index] || 0

  // Calculate breakdown if groupBy is specified
  const breakdown: ZeroDBInsightsResponse['breakdown'] = []
  if (query.groupBy) {
    const grouped = new Map<string, any[]>()

    rowsWithRatings.forEach((result: any) => {
      let key = ''

      switch (query.groupBy) {
        case 'model':
          key = result.model || 'unknown'
          break
        case 'template':
          key = result.template_used || 'none'
          break
        case 'day':
        case 'week':
        case 'month': {
          const date = new Date(result.created_at)
          if (query.groupBy === 'day') {
            key = date.toISOString().split('T')[0]
          } else if (query.groupBy === 'week') {
            const weekStart = new Date(date)
            weekStart.setDate(date.getDate() - date.getDay())
            key = weekStart.toISOString().split('T')[0]
          } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          }
          break
        }
        default:
          key = result.provider || 'unknown'
      }

      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(result)
    })

    grouped.forEach((items, key) => {
      const grpRated = items.filter((r: any) => r.rating !== null)
      const grpAvgRating =
        grpRated.length > 0
          ? grpRated.reduce((sum: number, r: any) => sum + (r.rating || 0), 0) / grpRated.length
          : 0

      const grpFirstPass = items.filter(
        (r: any) => r.rating && r.rating >= 4 && r.validation_valid !== false,
      ).length
      const grpFirstPassRate = items.length > 0 ? (grpFirstPass / items.length) * 100 : 0

      const grpEdited = items.filter((r: any) => r.retry_attempted).length
      const grpEditRate = items.length > 0 ? (grpEdited / items.length) * 100 : 0

      const grpLatencies = items.map((r: any) => r.generation_time_ms || 0).filter((t: number) => t > 0)
      const grpAvgTime =
        grpLatencies.length > 0
          ? grpLatencies.reduce((a: number, b: number) => a + b, 0) / grpLatencies.length
          : 0

      breakdown.push({
        key,
        label: key,
        avgRating: grpAvgRating,
        count: items.length,
        firstPassSuccessRate: grpFirstPassRate,
        editRate: grpEditRate,
        avgGenerationTimeMs: grpAvgTime,
      })
    })
  }

  return {
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
    topEditPatterns: [],
  }
}

// ============================================================
// FEEDBACK — writes to rlhf_feedback table
// ============================================================

export interface ZeroDBFeedbackData {
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

export async function submitFeedbackToZeroDB(data: ZeroDBFeedbackData): Promise<string> {
  const row = {
    chat_id: data.generationId,
    rating: data.rating,
    feedback_text: data.feedbackText || '',
    was_edited: data.wasEdited,
    iterations: data.iterations,
    edit_changes_summary: data.editChangesSummary ? JSON.stringify(data.editChangesSummary) : null,
    created_at: new Date().toISOString(),
  }

  const result = await zerodbFetch(zerodbUrl(FEEDBACK_TABLE), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ row_data: row }),
  })

  if (result) {
    console.log(`[ZeroDB-RLHF] Feedback saved: chatId=${data.generationId} rating=${data.rating}`)
    return result?.data?.id || `zerodb-${Date.now()}`
  }

  console.warn(`[ZeroDB-RLHF] Feedback save failed for ${data.generationId}`)
  return `feedback-placeholder-${Date.now()}`
}
