import { NextRequest, NextResponse } from 'next/server'
import { submitRLHFFeedback } from '@/lib/zerodb-store'

// RLHF Feedback API — stores to ZeroDB (persistent, no PostgreSQL needed)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const chatId = body.chatId || body.generationId
    const rating = body.rating || (body.feedback === 'Thumbs up' ? 5 : 1)

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
    }

    const saved = await submitRLHFFeedback({
      chatId,
      rating,
      feedback: body.feedbackText || body.feedback || '',
      prompt: body.prompt || '',
      model: body.model || '',
    })

    return NextResponse.json({
      success: saved,
      message: saved ? 'Feedback saved to ZeroDB' : 'Feedback save failed',
    })
  } catch (error) {
    console.error('[RLHF] Feedback error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
