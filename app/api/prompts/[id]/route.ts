import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getPromptById,
  updatePrompt,
} from '@/lib/services/prompt.service'

// Schema for updating a prompt version
const UpdatePromptSchema = z.object({
  content: z.string().min(1).optional(),
  metadata: z.record(z.any()).optional(),
  abTestPercentage: z.number().int().min(0).max(100).optional(),
})

// GET /api/prompts/[id] - Get prompt by ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const prompt = await getPromptById(params.id)
    return NextResponse.json({ prompt })
  } catch (error) {
    console.error('Error fetching prompt:', error)

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

// PUT /api/prompts/[id] - Update prompt version
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await request.json()

    // Validate request
    const validation = UpdatePromptSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: validation.error.format(),
        },
        { status: 400 },
      )
    }

    const data = validation.data

    // Update prompt
    const prompt = await updatePrompt(params.id, {
      content: data.content,
      metadata: data.metadata,
      abTestPercentage: data.abTestPercentage,
    })

    return NextResponse.json({
      prompt,
      message: 'Prompt updated successfully',
    })
  } catch (error) {
    console.error('Error updating prompt:', error)

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
