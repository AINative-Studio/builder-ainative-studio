import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import {
  createProject,
  freeTierProjectsRemaining,
  listProjects,
  listProjectsForWorkspace,
} from '@/lib/ainative/projects'
import { AINativeApiError, FREE_TIER_MAX_PROJECTS } from '@/lib/ainative/types'

export const runtime = 'nodejs'

/**
 * GET /api/projects[?workspaceId=...] — the user's projects (generated apps),
 * optionally scoped to one workspace.
 */
export async function GET(request: Request) {
  const session = await auth()
  const accessToken = (session as any)?.accessToken
  if (!accessToken) {
    return NextResponse.json({ error: 'AINative account required' }, { status: 401 })
  }
  const workspaceId = new URL(request.url).searchParams.get('workspaceId')
  try {
    const projects = workspaceId
      ? await listProjectsForWorkspace(accessToken, workspaceId)
      : await listProjects(accessToken)
    return NextResponse.json({
      projects,
      freeTier: {
        max: FREE_TIER_MAX_PROJECTS,
        remaining: freeTierProjectsRemaining(projects.length),
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/projects — create a project (a generated app). Each generated app
 * IS a core Project, scoped to a workspace via organization_id. If omitted,
 * core assigns the user's default workspace.
 */
export async function POST(request: Request) {
  const session = await auth()
  const accessToken = (session as any)?.accessToken
  if (!accessToken) {
    return NextResponse.json({ error: 'AINative account required' }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    if (!body?.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const organizationId = body.organizationId || body.workspaceId || (session as any).workspaceId

    const project = await createProject(accessToken, {
      name: body.name,
      description: body.description,
      tier: body.tier,
      organization_id: organizationId || undefined,
    })
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    // Surface the free-tier cap as an upgrade signal rather than a raw 4xx.
    if (err instanceof AINativeApiError && err.status === 403) {
      return NextResponse.json(
        {
          error: err.message,
          upgradeRequired: true,
          reason: 'free_tier_project_limit',
          max: FREE_TIER_MAX_PROJECTS,
        },
        { status: 403 },
      )
    }
    return errorResponse(err)
  }
}

function errorResponse(err: unknown) {
  if (err instanceof AINativeApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('[api/projects] error:', err)
  return NextResponse.json({ error: 'Failed to reach AINative' }, { status: 502 })
}
