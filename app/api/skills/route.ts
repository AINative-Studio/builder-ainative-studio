import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createSkill,
  getAllActiveSkills,
  getBuiltInSkills,
} from '@/lib/db/queries'
import { auth } from '@/app/(auth)/auth'

// GET /api/skills - List skills with optional filtering
export async function GET(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const builtInOnly = searchParams.get('builtInOnly') === 'true'

    const skills = builtInOnly
      ? await getBuiltInSkills()
      : await getAllActiveSkills()

    return NextResponse.json({ skills })
  } catch (error) {
    console.error('Error fetching skills:', error)
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 }
    )
  }
}

// POST /api/skills - Create a new skill
const createSkillSchema = z.object({
  id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver format
  tags: z.array(z.string()),
  triggerPatterns: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  tokenCostMetadata: z.number().int().positive().optional(),
  tokenCostFull: z.number().int().positive().optional(),
  compatibility: z.object({
    frameworks: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    minVersion: z.string().optional(),
  }).optional(),
  content: z.string().min(1),
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
  isBuiltIn: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = createSkillSchema.parse(body)

    const result = await createSkill({
      ...validatedData,
      authorId: session.user.id,
      authorName: session.user.email || 'Unknown',
      authorEmail: session.user.email,
    })

    return NextResponse.json({ skill: result[0] }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Error creating skill:', error)
    return NextResponse.json(
      { error: 'Failed to create skill' },
      { status: 500 }
    )
  }
}
