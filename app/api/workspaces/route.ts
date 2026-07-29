import { NextResponse } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { createWorkspace, listWorkspaces } from '@/lib/ainative/workspaces'
import { AINativeApiError, FREE_TIER_MAX_WORKSPACES } from '@/lib/ainative/types'

export const runtime = 'nodejs'

/** GET /api/workspaces — the signed-in user's AINative workspaces. */
export async function GET() {
  const session = await auth()
  const accessToken = (session as any)?.accessToken
  if (!accessToken) {
    return NextResponse.json(
      { error: 'AINative account required to list workspaces' },
      { status: 401 },
    )
  }
  try {
    const workspaces = await listWorkspaces(accessToken)
    return NextResponse.json({ workspaces })
  } catch (err) {
    return errorResponse(err)
  }
}

/** POST /api/workspaces — create a workspace. */
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
    const workspace = await createWorkspace(accessToken, {
      name: body.name,
      description: body.description,
      workspace_type: body.workspace_type,
    })
    return NextResponse.json({ workspace }, { status: 201 })
  } catch (err) {
    // Core enforces free/hobbyist max_workspaces=1 and returns 403
    // workspace_limit_reached. Surface it as an upgrade signal (same shape as
    // the project-limit response) rather than a raw 4xx, so the UI can prompt
    // an upgrade instead of showing an error.
    if (err instanceof AINativeApiError && err.status === 403) {
      return NextResponse.json(
        {
          error: err.message,
          upgradeRequired: true,
          reason: 'free_tier_workspace_limit',
          max: FREE_TIER_MAX_WORKSPACES,
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
  console.error('[api/workspaces] error:', err)
  return NextResponse.json({ error: 'Failed to reach AINative' }, { status: 502 })
}
