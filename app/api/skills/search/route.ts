import { NextRequest, NextResponse } from 'next/server'
import { getSkillService } from '@/lib/services/agent-skill.service'
import { auth } from '@/app/(auth)/auth'
import type { SkillSearchQuery } from '@/lib/types/agent-skills'

// GET /api/skills/search - Search skills with advanced filters
export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)

    const query: SkillSearchQuery = {
      query: searchParams.get('query') || undefined,
      tags: searchParams.get('tags')?.split(',').filter(Boolean),
      authorId: searchParams.get('authorId') || undefined,
      frameworks: searchParams.get('frameworks')?.split(',').filter(Boolean),
      languages: searchParams.get('languages')?.split(',').filter(Boolean),
      minRating: searchParams.get('minRating')
        ? Number(searchParams.get('minRating'))
        : undefined,
      sortBy: (searchParams.get('sortBy') as any) || 'relevance',
      limit: searchParams.get('limit')
        ? Number(searchParams.get('limit'))
        : 50,
      offset: searchParams.get('offset')
        ? Number(searchParams.get('offset'))
        : 0,
    }

    const skillService = getSkillService()
    const result = await skillService.searchSkills(query)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error searching skills:', error)
    return NextResponse.json(
      { error: 'Failed to search skills' },
      { status: 500 }
    )
  }
}
