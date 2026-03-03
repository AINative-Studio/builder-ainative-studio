import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { trackSkillUsage, getSkillById } from '@/lib/db/queries'
import { auth } from '@/app/(auth)/auth'

// POST /api/skills/[skillId]/usage - Track skill usage
const trackUsageSchema = z.object({
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  loadType: z.enum(['manual', 'auto', 'recommended']),
  triggerPattern: z.string().optional(),
  context: z.object({
    currentFile: z.string().optional(),
    gitBranch: z.string().optional(),
    hasUncommittedChanges: z.boolean().optional(),
    recentMessages: z.array(z.string()).optional(),
  }).optional(),
  loadTimeMs: z.number().int().positive(),
  metadataLoaded: z.boolean(),
  contentLoaded: z.boolean(),
  referencesLoaded: z.boolean(),
  tokensUsed: z.number().int().nonnegative(),
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
    const validatedData = trackUsageSchema.parse(body)

    // Check if skill exists
    const skill = await getSkillById(skillId)
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    const result = await trackSkillUsage({
      skillId,
      userId: session.user.id,
      ...validatedData,
    })

    return NextResponse.json({ usage: result[0] }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error tracking skill usage:', error)
    return NextResponse.json(
      { error: 'Failed to track skill usage' },
      { status: 500 }
    )
  }
}
