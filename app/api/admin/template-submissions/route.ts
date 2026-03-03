import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { template_submissions, users } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET /api/admin/template-submissions - List all submissions (admin only)
export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    // Check if user is admin (you may want to add an is_admin field to users table)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // For now, check if user email is admin (you should implement proper role-based access)
    // This is a placeholder - implement proper admin check based on your requirements
    const isAdmin = session.user.email?.includes('admin') || false

    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
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
