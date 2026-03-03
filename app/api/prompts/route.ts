import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getAllPrompts,
  createPrompt,
} from '@/lib/services/prompt.service'

// US-015: Prompt Version Management
// Schema for creating a new prompt version
const CreatePromptSchema = z.object({
  type: z.enum(['system', 'enhancement']),
  version: z.string().min(1).max(50),
  content: z.string().min(1),
  metadata: z.record(z.any()).optional(),
  abTestPercentage: z.number().int().min(0).max(100).optional(),
})

// GET /api/prompts - List all prompt versions
export async function GET(request: NextRequest) {
  try {
    const prompts = await getAllPrompts()

    return NextResponse.json({
      prompts,
      total: prompts.length,
    })
  } catch (error) {
    console.error('Error fetching prompts:', error)

    if (error instanceof Error && error.message === 'Database not available') {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

// POST /api/prompts - Create a new prompt version
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request
    const validation = CreatePromptSchema.safeParse(body)
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

    // Create prompt
    const prompt = await createPrompt({
      type: data.type,
      version: data.version,
      content: data.content,
      metadata: data.metadata,
      abTestPercentage: data.abTestPercentage,
    })

    return NextResponse.json(
      {
        prompt,
        message: 'Prompt version created successfully',
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('Error creating prompt:', error)

    if (error instanceof Error && error.message === 'Database not available') {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
