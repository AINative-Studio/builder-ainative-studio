/**
 * Few-Shot Examples CRUD API (US-028)
 *
 * Endpoints:
 * GET /api/few-shot-examples - List all examples (with optional category filter)
 * POST /api/few-shot-examples - Create new example
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/connection'
import { few_shot_examples } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

/**
 * GET /api/few-shot-examples
 * List all few-shot examples, optionally filtered by category
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    logger.info('Fetching few-shot examples', { category })

    const examples = category
      ? await db
          .select()
          .from(few_shot_examples)
          .where(eq(few_shot_examples.category, category))
      : await db.select().from(few_shot_examples)

    return NextResponse.json({
      examples,
      count: examples.length
    })
  } catch (error) {
    logger.error('Failed to fetch few-shot examples', { error })
    return NextResponse.json(
      { error: 'Failed to fetch examples' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/few-shot-examples
 * Create a new few-shot example
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { category, prompt, good_output, explanation, tags } = body

    // Validation
    if (!category || !prompt || !good_output || !explanation) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['category', 'prompt', 'good_output', 'explanation']
        },
        { status: 400 }
      )
    }

    if (!Array.isArray(tags)) {
      return NextResponse.json(
        { error: 'Tags must be an array' },
        { status: 400 }
      )
    }

    logger.info('Creating new few-shot example', { category })

    const [newExample] = await db
      .insert(few_shot_examples)
      .values({
        category,
        prompt,
        good_output,
        explanation,
        tags
      })
      .returning()

    return NextResponse.json(
      {
        example: newExample,
        message: 'Example created successfully'
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('Failed to create few-shot example', { error })
    return NextResponse.json(
      { error: 'Failed to create example' },
      { status: 500 }
    )
  }
}
