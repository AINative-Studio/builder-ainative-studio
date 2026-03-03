/**
 * Evidence API Endpoints
 * GET /api/evidence - List evidence with filtering
 * POST /api/evidence/capture - Capture new evidence
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { evidence } from '@/lib/db/schema'
import { eq, and, desc, sql, or, like } from 'drizzle-orm'
import { getEvidenceCollectorService } from '@/lib/services/evidence-collector.service'
import type { EvidenceType, EvidenceStatus } from '@/lib/types/evidence'

// Validation schema for evidence listing
const evidenceListSchema = z.object({
  type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  git_branch: z.string().nullable().optional(),
  git_commit: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  search: z.string().nullable().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// Validation schema for evidence capture
const evidenceCaptureSchema = z.object({
  user_id: z.string().uuid(),
  type: z.enum([
    'test-run',
    'build',
    'coverage',
    'deployment',
    'screenshot',
    'lint',
    'type-check',
    'command-execution',
  ]),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeout: z.number().min(1000).max(600000).optional(),
  captureOutput: z.boolean().default(true),
  captureArtifacts: z.boolean().default(true),
})

/**
 * GET /api/evidence
 * List evidence with filtering and pagination
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const params = evidenceListSchema.parse({
      type: searchParams.get('type'),
      status: searchParams.get('status'),
      project_id: searchParams.get('project_id'),
      git_branch: searchParams.get('git_branch'),
      git_commit: searchParams.get('git_commit'),
      date_from: searchParams.get('date_from'),
      date_to: searchParams.get('date_to'),
      search: searchParams.get('search'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    })

    // Build where conditions
    const conditions = []

    if (params.type) {
      conditions.push(eq(evidence.type, params.type as EvidenceType))
    }

    if (params.status) {
      conditions.push(eq(evidence.status, params.status as EvidenceStatus))
    }

    if (params.project_id) {
      conditions.push(eq(evidence.project_id, params.project_id))
    }

    if (params.git_branch) {
      conditions.push(eq(evidence.git_branch, params.git_branch))
    }

    if (params.git_commit) {
      conditions.push(eq(evidence.git_commit, params.git_commit))
    }

    if (params.date_from) {
      conditions.push(sql`${evidence.created_at} >= ${new Date(params.date_from)}`)
    }

    if (params.date_to) {
      conditions.push(sql`${evidence.created_at} <= ${new Date(params.date_to)}`)
    }

    if (params.search) {
      conditions.push(
        or(
          like(evidence.title, `%${params.search}%`),
          like(evidence.description, `%${params.search}%`),
          like(evidence.command, `%${params.search}%`)
        )!
      )
    }

    // Query evidence
    const results = await db
      .select()
      .from(evidence)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(evidence.created_at))
      .limit(params.limit)
      .offset(params.offset)

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(evidence)
      .where(conditions.length > 0 ? and(...conditions) : undefined)

    return NextResponse.json({
      evidence: results,
      pagination: {
        total: count,
        limit: params.limit,
        offset: params.offset,
        hasMore: params.offset + params.limit < count,
      },
    })
  } catch (error) {
    console.error('Evidence list error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: error.errors }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to list evidence' }, { status: 500 })
  }
}

/**
 * POST /api/evidence/capture
 * Capture evidence by executing a command
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const params = evidenceCaptureSchema.parse(body)

    const collector = getEvidenceCollectorService()

    const result = await collector.captureCommand(params.user_id, {
      type: params.type,
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      timeout: params.timeout,
      captureOutput: params.captureOutput,
      captureArtifacts: params.captureArtifacts,
    })

    return NextResponse.json({
      evidence: result.evidence,
      artifacts: result.artifacts,
      success: result.success,
      error: result.error,
    })
  } catch (error) {
    console.error('Evidence capture error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body', details: error.errors }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Failed to capture evidence', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
