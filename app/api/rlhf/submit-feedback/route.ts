import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { submitFeedback } from '@/lib/services/rlhf.service'

// US-013: Feedback Submission API
// Request validation schema
const FeedbackSchema = z.object({
  generationId: z.string().min(1, 'generationId is required'), // Allow nanoid or UUID
  rating: z
    .number()
    .int()
    .min(1, 'Rating must be at least 1')
    .max(5, 'Rating must be at most 5'),
  feedbackText: z.string().max(1000).optional(),
  wasEdited: z.boolean(),
  iterations: z.number().int().min(1).default(1),
  editChangesSummary: z
    .object({
      linesAdded: z.number().int().optional(),
      linesRemoved: z.number().int().optional(),
      componentsChanged: z.array(z.string()).optional(),
      styleChanges: z.array(z.string()).optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request with Zod
    const validation = FeedbackSchema.safeParse(body)
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

    // Submit feedback using service layer
    const feedbackId = await submitFeedback({
      generationId: data.generationId,
      rating: data.rating,
      feedbackText: data.feedbackText,
      wasEdited: data.wasEdited,
      iterations: data.iterations,
      editChangesSummary: data.editChangesSummary,
    })

    return NextResponse.json({
      success: true,
      feedbackId,
      message: 'Feedback submitted successfully',
    })
  } catch (error) {
    console.error('Error submitting feedback:', error)

    // Handle specific errors
    if (error instanceof Error) {
      if (error.message === 'Generation not found') {
        return NextResponse.json(
          { error: 'Generation not found' },
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
