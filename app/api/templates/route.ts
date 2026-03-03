import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { templates } from '@/lib/db/schema'
import { and, eq, ilike, or, desc, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET /api/templates - List and filter templates
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const category = searchParams.get('category')
    const tags = searchParams.get('tags')?.split(',').filter(Boolean)
    const search = searchParams.get('search')
    const complexity = searchParams.get('complexity')
    const sort = searchParams.get('sort') || 'most-used'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '12')
    const offset = (page - 1) * limit

    // Build filter conditions
    const conditions = [eq(templates.is_active, true)]

    if (category && category !== 'all') {
      conditions.push(eq(templates.category, category))
    }

    if (search) {
      conditions.push(
        or(
          ilike(templates.name, `%${search}%`),
          ilike(templates.description, `%${search}%`)
        )!
      )
    }

    if (complexity) {
      conditions.push(sql`${templates.metadata}->>'complexity' = ${complexity}`)
    }

    if (tags && tags.length > 0) {
      conditions.push(
        sql`${templates.tags} @> ${JSON.stringify(tags)}`
      )
    }

    // Build order by clause
    let orderByClause
    switch (sort) {
      case 'most-used':
        orderByClause = desc(templates.usage_count)
        break
      case 'newest':
        orderByClause = desc(templates.created_at)
        break
      case 'a-z':
        orderByClause = templates.name
        break
      default:
        orderByClause = desc(templates.usage_count)
    }

    // Execute query with pagination
    const [templateList, countResult] = await Promise.all([
      db
        .select()
        .from(templates)
        .where(and(...conditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(templates)
        .where(and(...conditions))
    ])

    const total = Number(countResult[0]?.count || 0)
    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      templates: templateList,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    })
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}
