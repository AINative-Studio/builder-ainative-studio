import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { template_submissions, templates } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

// PATCH /api/admin/template-submissions/:id - Approve or reject submission
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.status === 401 ? 'Unauthorized' : 'Forbidden: Admin access required' },
        { status: admin.status }
      )
    }

    const { id } = await params
    const body = await request.json()
    const { action, admin_notes } = body

    // Fetch submission
    const [submission] = await db
      .select()
      .from(template_submissions)
      .where(eq(template_submissions.id, id))
      .limit(1)

    if (!submission) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
      )
    }

    if (action === 'approve') {
      // Create template from submission
      const [newTemplate] = await db
        .insert(templates)
        .values({
          name: submission.template_data.name,
          category: submission.template_data.category,
          description: submission.template_data.description,
          code: submission.template_data.code,
          tags: submission.template_data.tags,
          metadata: submission.template_data.metadata,
          is_active: true,
          usage_count: 0,
        })
        .returning()

      // Update submission status
      await db
        .update(template_submissions)
        .set({
          status: 'approved',
          reviewed_at: new Date(),
          reviewed_by: admin.userId,
          admin_notes,
        })
        .where(eq(template_submissions.id, id))

      return NextResponse.json({
        message: 'Template approved and published',
        template: newTemplate,
      })
    } else if (action === 'reject') {
      // Update submission status
      await db
        .update(template_submissions)
        .set({
          status: 'rejected',
          reviewed_at: new Date(),
          reviewed_by: admin.userId,
          admin_notes,
        })
        .where(eq(template_submissions.id, id))

      return NextResponse.json({
        message: 'Template rejected',
      })
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error reviewing submission:', error)
    return NextResponse.json(
      { error: 'Failed to review submission' },
      { status: 500 }
    )
  }
}
