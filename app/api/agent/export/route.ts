import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

/**
 * Agent Runs Export — /api/agent/export (builder#57)
 *
 * Exports agent runs as JSONL for offline analysis and fine-tuning.
 *
 * Query params:
 *   days=30  (default: 30, max: 365)
 *   limit=1000 (default: 1000, max: 10000)
 *   model=claude-sonnet-4 (optional filter)
 *   format=jsonl|json (default: jsonl)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    const url = new URL(request.url)
    const format = url.searchParams.get('format') || 'jsonl'
    const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 10000)
    const modelFilter = url.searchParams.get('model')

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

    const filters: Record<string, any> = {
      created_at: { $gte: sinceDate.toISOString() },
    }
    if (modelFilter) filters.model = modelFilter

    const response = await fetch(
      `${baseUrl}/api/v1/projects/${projectId}/database/tables/agent_runs/rows`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters,
          limit,
          sort: { created_at: 'desc' },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )

    if (!response.ok) {
      console.warn('[AgentExport] Query failed:', response.status)
      return exportResponse([], format)
    }

    const data = await response.json()
    const rows: any[] = data.rows || data.data || []

    // Transform to export format
    const exportData = rows.map((row: any) => ({
      chatId: row.chat_id,
      model: row.model,
      turns: row.turns ?? 0,
      buildPassed: Boolean(row.build_passed),
      durationMs: row.duration_ms ?? 0,
      fallback: Boolean(row.fallback),
      toolsUsed: safeParseArray(row.tools_used),
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.total_cost_usd ?? 0,
      error: row.error || null,
      createdAt: row.created_at,
    }))

    return exportResponse(exportData, format)
  } catch (error) {
    console.error('[AgentExport] Error:', error)
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}

function safeParseArray(value: any): string[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function exportResponse(data: any[], format: string) {
  if (format === 'jsonl') {
    const jsonl = data.map((row) => JSON.stringify(row)).join('\n')
    return new Response(jsonl || '', {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="agent-runs-${new Date().toISOString().split('T')[0]}.jsonl"`,
      },
    })
  }

  return Response.json({
    count: data.length,
    exported_at: new Date().toISOString(),
    data,
  })
}
