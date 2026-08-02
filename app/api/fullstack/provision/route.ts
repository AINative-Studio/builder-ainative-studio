/**
 * Full-Stack Provision API (Issue #36)
 *
 * POST /api/fullstack/provision
 *   Body: { prompt: string, requireAuth?: boolean, dryRun?: boolean,
 *           projectId?: string, maxTables?: number }
 *
 * Infers a backend data model from the prompt, auto-provisions ZeroDB tables,
 * and returns the API endpoints, auth scaffold, and a drop-in TypeScript client
 * for the generated UI. This is the backend half of full-stack generation.
 *
 * GET /api/fullstack/provision?prompt=...
 *   Convenience preview (always a dry run — never provisions).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { generateBackend } from '@/lib/services/fullstack-generator.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bodySchema = z.object({
  prompt: z.string().min(1, 'prompt is required').max(4000),
  requireAuth: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  projectId: z.string().optional(),
  maxTables: z.number().int().positive().max(20).optional(),
})

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await generateBackend(parsed.data.prompt, {
      requireAuth: parsed.data.requireAuth,
      dryRun: parsed.data.dryRun,
      projectId: parsed.data.projectId,
      maxTables: parsed.data.maxTables,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Backend provisioning failed',
        detail: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const prompt = request.nextUrl.searchParams.get('prompt')
  if (!prompt) {
    return NextResponse.json({ error: 'prompt query param required' }, { status: 400 })
  }

  try {
    // GET is always a preview; never touch the database.
    const result = await generateBackend(prompt, { dryRun: true })
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Backend preview failed',
        detail: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 }
    )
  }
}
