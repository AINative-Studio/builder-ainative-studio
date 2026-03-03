import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSkillService } from '@/lib/services/agent-skill.service'
import { auth } from '@/app/(auth)/auth'
import type { SkillContext } from '@/lib/types/agent-skills'

// POST /api/skills/recommend - Get skill recommendations based on context
const recommendContextSchema = z.object({
  sessionId: z.string(),
  projectId: z.string().optional(),
  currentFile: z.string().optional(),
  recentMessages: z.array(z.string()).optional(),
  gitContext: z.object({
    branch: z.string(),
    hasUncommittedChanges: z.boolean(),
    lastCommitMessage: z.string().optional(),
  }).optional(),
  tokenBudget: z.object({
    total: z.number().int().positive(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = recommendContextSchema.parse(body)

    const context: SkillContext = {
      userId: session.user.id,
      ...validatedData,
    }

    const skillService = getSkillService()
    const recommendations = await skillService.recommendSkills(context)

    return NextResponse.json({ recommendations })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error recommending skills:', error)
    return NextResponse.json(
      { error: 'Failed to recommend skills' },
      { status: 500 }
    )
  }
}
