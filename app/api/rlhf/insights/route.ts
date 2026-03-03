import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInsights } from '@/lib/services/rlhf.service'

// US-014: Quality Insights Dashboard API
// Query parameters validation
const InsightsQuerySchema = z.object({
  timeRange: z.enum(['1d', '7d', '30d']).default('7d'),
  groupBy: z
    .enum(['promptVersion', 'model', 'template', 'day', 'week', 'month'])
    .optional(),
  promptVersionId: z.string().uuid().optional(),
})

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    const searchParams = request.nextUrl.searchParams

    // Parse and validate query parameters
    const queryParams = {
      timeRange: searchParams.get('timeRange') || '7d',
      groupBy: searchParams.get('groupBy') || undefined,
      promptVersionId: searchParams.get('promptVersionId') || undefined,
    }

    const validation = InsightsQuerySchema.safeParse(queryParams)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: validation.error.format(),
        },
        { status: 400 },
      )
    }

    const query = validation.data

    // Get insights from service (with caching)
    const insights = await getInsights({
      timeRange: query.timeRange,
      groupBy: query.groupBy,
      promptVersionId: query.promptVersionId,
    })

    const responseTime = Date.now() - startTime

    return NextResponse.json(
      {
        ...insights,
        _meta: {
          responseTime: `${responseTime}ms`,
          cached: responseTime < 100, // Likely cached if under 100ms
        },
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300', // 5 minutes browser cache
        },
      },
    )
  } catch (error) {
    console.error('Error fetching insights:', error)

    if (error instanceof Error) {
      if (error.message === 'Database not available') {
        return NextResponse.json(
          { error: 'Service temporarily unavailable' },
          { status: 503 },
        )
      }
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
