import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { template_submissions, users } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

// GET /api/admin/template-submissions - List all submissions (admin only)
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin()

    if (!admin.ok) {
      return NextResponse.json(
        { error: admin.status === 401 ? 'Unauthorized' : 'Forbidden: Admin access required' },
        { status: admin.status }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || 'pending'

    // Fetch submissions with user info
    const submissions = await db
      .select({
        submission: template_submissions,
        user: {
          id: users.id,
          email: users.email,
        },
      })
      .from(template_submissions)
      .leftJoin(users, eq(template_submissions.user_id, users.id))
      .where(eq(template_submissions.status, status))
      .orderBy(desc(template_submissions.submitted_at))

    return NextResponse.json({ submissions })
  } catch (error) {
    console.error('Error fetching submissions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch submissions' },
      { status: 500 }
    )
  }
}
