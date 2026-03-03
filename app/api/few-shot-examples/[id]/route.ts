/**
 * Few-Shot Examples CRUD API - Individual Example (US-028)
 *
 * Endpoints:
 * GET /api/few-shot-examples/[id] - Get example by ID
 * PUT /api/few-shot-examples/[id] - Update example
 * DELETE /api/few-shot-examples/[id] - Delete example
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/connection'
import { few_shot_examples } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/logger'

/**
 * GET /api/few-shot-examples/[id]
 * Get a specific few-shot example by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    logger.info('Fetching few-shot example', { id })

    const [example] = await db
      .select()
      .from(few_shot_examples)
      .where(eq(few_shot_examples.id, id))
      .limit(1)

    if (!example) {
      return NextResponse.json(
        { error: 'Example not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ example })
  } catch (error) {
    logger.error('Failed to fetch few-shot example', { error })
    return NextResponse.json(
      { error: 'Failed to fetch example' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/few-shot-examples/[id]
 * Update a few-shot example
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await request.json()
    const { category, prompt, good_output, explanation, tags } = body

    logger.info('Updating few-shot example', { id })

    // Build update object with only provided fields
    const updateData: any = {}
    if (category) updateData.category = category
    if (prompt) updateData.prompt = prompt
    if (good_output) updateData.good_output = good_output
    if (explanation) updateData.explanation = explanation
    if (tags && Array.isArray(tags)) updateData.tags = tags

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    const [updatedExample] = await db
      .update(few_shot_examples)
      .set(updateData)
      .where(eq(few_shot_examples.id, id))
      .returning()

    if (!updatedExample) {
      return NextResponse.json(
        { error: 'Example not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      example: updatedExample,
      message: 'Example updated successfully'
    })
  } catch (error) {
    logger.error('Failed to update few-shot example', { error })
    return NextResponse.json(
      { error: 'Failed to update example' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/few-shot-examples/[id]
 * Delete a few-shot example
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    logger.info('Deleting few-shot example', { id })

    const [deletedExample] = await db
      .delete(few_shot_examples)
      .where(eq(few_shot_examples.id, id))
      .returning()

    if (!deletedExample) {
      return NextResponse.json(
        { error: 'Example not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      message: 'Example deleted successfully',
      example: deletedExample
    })
  } catch (error) {
    logger.error('Failed to delete few-shot example', { error })
    return NextResponse.json(
      { error: 'Failed to delete example' },
      { status: 500 }
    )
  }
}
