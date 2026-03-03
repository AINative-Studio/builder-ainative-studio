import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getSkillById,
  updateSkill,
  deleteSkill,
  getSkillUsageStats,
  getSkillRatings,
} from '@/lib/db/queries'
import { auth } from '@/app/(auth)/auth'

// GET /api/skills/[skillId] - Get a specific skill
export async function GET(
  request: NextRequest,
  { params }: { params: { skillId: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { skillId } = params
    const { searchParams } = new URL(request.url)
    const includeStats = searchParams.get('includeStats') === 'true'
    const includeRatings = searchParams.get('includeRatings') === 'true'

    const skill = await getSkillById(skillId)

    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    const response: any = { skill }

    if (includeStats) {
      const stats = await getSkillUsageStats(skillId)
      response.stats = stats
    }

    if (includeRatings) {
      const ratings = await getSkillRatings(skillId)
      response.ratings = ratings
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error fetching skill:', error)
    return NextResponse.json(
      { error: 'Failed to fetch skill' },
      { status: 500 }
    )
  }
}

// PATCH /api/skills/[skillId] - Update a skill
const updateSkillSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  tags: z.array(z.string()).optional(),
  triggerPatterns: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  tokenCostMetadata: z.number().int().positive().optional(),
  tokenCostFull: z.number().int().positive().optional(),
  compatibility: z.object({
    frameworks: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    minVersion: z.string().optional(),
  }).optional(),
  content: z.string().min(1).optional(),
  references: z.array(z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['markdown', 'code', 'url', 'example']),
    description: z.string().optional(),
  })).optional(),
  examples: z.array(z.object({
    title: z.string(),
    content: z.string(),
    language: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  validationRules: z.array(z.string()).optional(),
  commands: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(
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
    const validatedData = updateSkillSchema.parse(body)

    // Check if skill exists and user has permission
    const skill = await getSkillById(skillId)
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    // Only allow author or admin to update
    if (skill.author_id !== session.user.id && !skill.is_built_in) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await updateSkill(skillId, validatedData)

    return NextResponse.json({ skill: result[0] })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error updating skill:', error)
    return NextResponse.json(
      { error: 'Failed to update skill' },
      { status: 500 }
    )
  }
}

// DELETE /api/skills/[skillId] - Delete a skill
export async function DELETE(
  request: NextRequest,
  { params }: { params: { skillId: string } }
) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { skillId } = params

    // Check if skill exists and user has permission
    const skill = await getSkillById(skillId)
    if (!skill) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    // Only allow author or admin to delete
    // Built-in skills cannot be deleted
    if (skill.is_built_in) {
      return NextResponse.json(
        { error: 'Cannot delete built-in skills' },
        { status: 403 }
      )
    }

    if (skill.author_id !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await deleteSkill(skillId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting skill:', error)
    return NextResponse.json(
      { error: 'Failed to delete skill' },
      { status: 500 }
    )
  }
}
