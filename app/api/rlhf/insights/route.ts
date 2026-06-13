import { NextRequest, NextResponse } from 'next/server'
import { getRLHFInsights } from '@/lib/zerodb-store'

// RLHF Insights API — reads from ZeroDB feedback table
export async function GET(request: NextRequest) {
  try {
    const insights = await getRLHFInsights()

    if (!insights) {
      return NextResponse.json({
        totalGenerations: 0,
        avgRating: 0,
        passRate: 0,
        avgCodeLength: 0,
        modelBreakdown: {},
        categoryBreakdown: {},
        message: 'No RLHF data yet — generate some apps and provide feedback',
      })
    }

    return NextResponse.json(insights, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  } catch (error) {
    console.error('[RLHF] Insights error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
