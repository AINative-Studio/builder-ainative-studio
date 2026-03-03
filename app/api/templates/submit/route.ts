import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { template_submissions } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

// POST /api/templates/submit - Submit a new template for review
export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name, category, description, code, tags, metadata } = body

    // Basic validation
    if (!name || !category || !description || !code) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Security check: no external imports
    const hasExternalImports = /import\s+.*\s+from\s+['"][^@/.]/.test(code)
    if (hasExternalImports) {
      return NextResponse.json(
        { error: 'Code contains external imports. Only local and @/ imports are allowed.' },
        { status: 400 }
      )
    }

    // Create submission
    const [submission] = await db
      .insert(template_submissions)
      .values({
        user_id: session.user.id,
        template_data: {
          name,
          category,
          description,
          code,
          tags: tags || [],
          metadata: metadata || {
            placeholders: [],
            components_used: [],
            complexity: 'simple',
          },
        },
        status: 'pending',
      })
      .returning()

    return NextResponse.json({
      submission,
      message: 'Template submitted successfully! It will be reviewed within 1-2 days.',
    })
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json(
      { error: 'Failed to submit template' },
      { status: 500 }
    )
  }
}
