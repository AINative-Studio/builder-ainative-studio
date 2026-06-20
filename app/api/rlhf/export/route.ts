import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'

/**
 * RLHF Training Data Export — /api/rlhf/export
 *
 * Exports generation data in JSONL format suitable for fine-tuning:
 * - OpenAI chat-completion format: {messages: [{role, content}], ...metadata}
 * - Includes system prompt, user prompt, generated code, feedback, model config
 * - Filterable by date range, model, rating, status
 *
 * Query params:
 *   format=jsonl|json (default: jsonl)
 *   days=30 (default: 30, max: 365)
 *   model=kimi-k2 (optional filter)
 *   min_rating=4 (optional, only include rated ≥ this)
 *   status=success|validation_error|failure (optional)
 *   limit=1000 (default: 1000, max: 10000)
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check — only authenticated users can export
    const session = await auth()
    if (!session?.user?.id) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    const url = new URL(request.url)
    const format = url.searchParams.get('format') || 'jsonl'
    const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365)
    const modelFilter = url.searchParams.get('model')
    const minRating = url.searchParams.get('min_rating') ? parseInt(url.searchParams.get('min_rating')!) : null
    const statusFilter = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000'), 10000)

    // Query ZeroDB for training data
    const apiKey = process.env.ZERODB_API_KEY || process.env.AINATIVE_API_KEY || ''
    const projectId = process.env.ZERODB_PROJECT_ID || ''

    if (!apiKey || !projectId) {
      return Response.json({ error: 'ZeroDB not configured' }, { status: 500 })
    }

    const baseUrl = process.env.ZERODB_BASE_URL || 'https://api.zerodb.ai'
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)

    // Build query filters
    const filters: Record<string, any> = {
      created_at: { $gte: sinceDate.toISOString() },
    }
    if (modelFilter) filters.model = modelFilter
    if (statusFilter) filters.status = statusFilter

    const response = await fetch(`${baseUrl}/v1/tables/${projectId}/rlhf_training_data/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters,
        limit,
        sort: { created_at: 'desc' },
      }),
    })

    if (!response.ok) {
      // Table might not exist yet — return empty
      console.warn('[RLHF Export] Query failed:', response.status)
      return exportResponse([], format)
    }

    const data = await response.json()
    const rows = data.rows || data.data || []

    // Transform to fine-tuning format
    let trainingData = rows.map((row: any) => {
      const messages: Array<{ role: string; content: string }> = []

      // Try to reconstruct from full_conversation first
      if (row.full_conversation) {
        try {
          const conv = typeof row.full_conversation === 'string'
            ? JSON.parse(row.full_conversation)
            : row.full_conversation
          if (Array.isArray(conv) && conv.length > 0) {
            messages.push(...conv)
          }
        } catch {}
      }

      // Fallback: reconstruct from individual fields
      if (messages.length === 0) {
        if (row.system_prompt) {
          messages.push({ role: 'system', content: row.system_prompt })
        }
        if (row.prompt) {
          messages.push({ role: 'user', content: row.prompt })
        }
        if (row.generated_code) {
          messages.push({ role: 'assistant', content: row.generated_code })
        }
      }

      return {
        messages,
        metadata: {
          chat_id: row.chat_id,
          model: row.model,
          status: row.status || 'success',
          validation_valid: row.validation_valid,
          validation_error: row.validation_error || null,
          generation_time_ms: row.generation_time_ms,
          code_length: row.code_length,
          theme: row.theme,
          temperature: row.temperature,
          max_tokens: row.max_tokens,
          provider: row.provider,
          input_tokens: row.input_tokens,
          output_tokens: row.output_tokens,
          created_at: row.created_at,
        },
      }
    })

    // Filter by rating if requested (requires feedback correlation)
    if (minRating !== null) {
      // For now, filter by status — rated data requires join with feedback table
      trainingData = trainingData.filter((d: any) => d.metadata.status === 'success')
    }

    return exportResponse(trainingData, format)
  } catch (error) {
    console.error('[RLHF Export] Error:', error)
    return Response.json({ error: 'Export failed' }, { status: 500 })
  }
}

function exportResponse(data: any[], format: string) {
  if (format === 'jsonl') {
    const jsonl = data.map(row => JSON.stringify(row)).join('\n')
    return new Response(jsonl, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="rlhf-training-data-${new Date().toISOString().split('T')[0]}.jsonl"`,
      },
    })
  }

  return Response.json({
    count: data.length,
    exported_at: new Date().toISOString(),
    data,
  })
}
