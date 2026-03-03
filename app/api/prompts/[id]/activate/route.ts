import { NextRequest, NextResponse } from 'next/server'
import { activatePrompt } from '@/lib/services/prompt.service'

// PUT /api/prompts/[id]/activate - Activate a prompt version
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const prompt = await activatePrompt(params.id)

    return NextResponse.json({
      prompt,
      message: 'Prompt activated successfully',
    })
  } catch (error) {
    console.error('Error activating prompt:', error)

    if (error instanceof Error) {
      if (error.message === 'Prompt not found') {
        return NextResponse.json(
          { error: 'Prompt not found' },
          { status: 404 },
        )
      }
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
