import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { upsertSkillRating, getSkillById } from '@/lib/db/queries'
import { auth } from '@/app/(auth)/auth'

// POST /api/skills/[skillId]/rating - Rate a skill
const rateSkillSchema = z.object({
  rating: z.number().int().min(1).max(5),
  feedbackText: z.string().optional(),
  helpful: z.boolean().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { skillId: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { skillId } = params
    const body = await request.json()
    const validatedData = rateSkillSchema.parse(body)

    // Check if skill exists
    const skill = await getSkillById(skillId)
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    const result = await upsertSkillRating({
      skillId,
      userId: session.user.id,
      ...validatedData,
    })

    return NextResponse.json({ rating: result[0] })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error rating skill:', error)
    return NextResponse.json(
      { error: 'Failed to rate skill' },
      { status: 500 }
    )
  }
}
