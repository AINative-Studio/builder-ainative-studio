import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { templates } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

// GET /api/templates/:id - Get single template and increment usage count
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id } = await params

    const template = await db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (!template || template.length === 0) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Increment usage count
    await db
      .update(templates)
      .set({ usage_count: template[0].usage_count + 1 })
      .where(eq(templates.id, id))

    return NextResponse.json({
      template: {
        ...template[0],
        usage_count: template[0].usage_count + 1,
      },
    })
  } catch (error) {
    console.error('Error fetching template:', error)
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    )
  }
}
