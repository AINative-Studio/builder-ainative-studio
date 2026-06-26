import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

/**
 * Agent Metrics API — /api/agent/metrics (builder#57)
 *
 * Returns aggregated metrics for headless Claude agent runs.
 *
 * Query params:
 *   days=7 (default: 7, max: 90)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    const url = new URL(request.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)

    const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
    const projectId =
      process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

    if (!apiKey) {
      return Response.json({ error: 'ZeroDB not configured' }, { status: 500 })
    }

    const baseUrl =
      process.env.AINATIVE_API_URL ||
      process.env.ZERODB_BASE_URL ||
      'https://api.ainative.studio'

    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)

    // Query all agent runs within the date range
    const response = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/database/tables/agent_runs/rows`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            created_at: { $gte: sinceDate.toISOString() },
          },
          limit: 10000,
          sort: { created_at: 'desc' },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )

    if (!response.ok) {
      // Table might not exist yet — return zeroed metrics
      console.warn('[AgentMetrics] Query failed:', response.status)
      return Response.json(emptyMetrics())
    }

    const data = await response.json()
    const rows: AgentRow[] = data.rows || data.data || []

    // Also query fast-path generations (non-agent) for comparison
    const fastPathResponse = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/database/tables/rlhf_training_data/rows`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            created_at: { $gte: sinceDate.toISOString() },
          },
          limit: 10000,
          sort: { created_at: 'desc' },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    ).catch(() => null)

    let fastPathRows: any[] = []
    if (fastPathResponse?.ok) {
      const fpData = await fastPathResponse.json()
      fastPathRows = fpData.rows || fpData.data || []
    }

    return Response.json(computeMetrics(rows, fastPathRows, days))
  } catch (error) {
    console.error('[AgentMetrics] Error:', error)
    return Response.json({ error: 'Metrics query failed' }, { status: 500 })
  }
}

interface AgentRow {
  chat_id: string
  model: string
  turns: number
  build_passed: boolean
  duration_ms: number
  fallback: boolean
  total_cost_usd: number
  error?: string | null
  created_at: string
}

function emptyMetrics() {
  return {
    totalRuns: 0,
    buildPassRate: 0,
    avgTurns: 0,
    avgDurationMs: 0,
    fallbackRate: 0,
    fallbackSuccessRate: 0,
    costPerGeneration: 0,
    comparisonVsFastPath: {
      agentSuccessRate: 0,
      fastPathSuccessRate: 0,
      improvement: '+0%',
    },
  }
}

function computeMetrics(rows: AgentRow[], fastPathRows: any[], days: number) {
  const totalRuns = rows.length
  if (totalRuns === 0) return emptyMetrics()

  const passed = rows.filter((r) => r.build_passed)
  const buildPassRate = round(passed.length / totalRuns)

  const avgTurns = round(
    rows.reduce((sum, r) => sum + (r.turns || 0), 0) / totalRuns,
  )

  const avgDurationMs = Math.round(
    rows.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / totalRuns,
  )

  const fallbackRuns = rows.filter((r) => r.fallback)
  const fallbackRate = round(fallbackRuns.length / totalRuns)

  const fallbackSuccessRate =
    fallbackRuns.length > 0
      ? round(
          fallbackRuns.filter((r) => r.build_passed).length /
            fallbackRuns.length,
        )
      : 0

  const totalCost = rows.reduce(
    (sum, r) => sum + (r.total_cost_usd || 0),
    0,
  )
  const costPerGeneration = round(totalCost / totalRuns, 4)

  // Compare agent vs fast-path success rates
  const agentSuccessRate = buildPassRate
  const fastPathValid = fastPathRows.filter(
    (r: any) => r.validation_valid === true || r.validation_valid === 1,
  )
  const fastPathSuccessRate =
    fastPathRows.length > 0
      ? round(fastPathValid.length / fastPathRows.length)
      : 0

  const improvementPct =
    fastPathSuccessRate > 0
      ? Math.round((agentSuccessRate - fastPathSuccessRate) * 100)
      : 0
  const improvement =
    improvementPct >= 0 ? `+${improvementPct}%` : `${improvementPct}%`

  return {
    totalRuns,
    buildPassRate,
    avgTurns,
    avgDurationMs,
    fallbackRate,
    fallbackSuccessRate,
    costPerGeneration,
    days,
    comparisonVsFastPath: {
      agentSuccessRate,
      fastPathSuccessRate,
      improvement,
    },
  }
}

function round(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals)
  return Math.round(n * factor) / factor
}
