import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — /api/plan, /api/workspaces, /api/projects are
 * the templatable "auth-gate -> call lib/ainative -> map result/error onto
 * status code" shape the issue describes. All three: no session -> safe
 * default / 401; lib throws AINativeApiError -> status passed through
 * (plus an upgradeRequired reason on 403 for workspaces/projects); any other
 * throw -> 502 (or, for /api/plan, a safe default since it must never hard-fail).
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const plan = vi.hoisted(() => ({ getPlanStatus: vi.fn() }))
vi.mock('@/lib/ainative/plan', () => ({ getPlanStatus: plan.getPlanStatus }))

const workspaces = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
}))
vi.mock('@/lib/ainative/workspaces', () => ({
  listWorkspaces: workspaces.listWorkspaces,
  createWorkspace: workspaces.createWorkspace,
}))

const projects = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listProjectsForWorkspace: vi.fn(),
  createProject: vi.fn(),
  freeTierProjectsRemaining: vi.fn(() => 2),
}))
vi.mock('@/lib/ainative/projects', () => ({
  listProjects: projects.listProjects,
  listProjectsForWorkspace: projects.listProjectsForWorkspace,
  createProject: projects.createProject,
  freeTierProjectsRemaining: projects.freeTierProjectsRemaining,
}))

import { mockGetRequest, mockJsonRequest, fakeSession, noSession } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/plan', () => {
  it('returns a safe Hobbyist default with signedIn:false when there is no session', async () => {
    auth.auth.mockResolvedValue(noSession)
    const { GET } = await import('@/app/api/plan/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signedIn).toBe(false)
    expect(body.tier).toBe('hobbyist')
    expect(plan.getPlanStatus).not.toHaveBeenCalled()
  })

  it('returns the real plan status with signedIn:true when authenticated', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    plan.getPlanStatus.mockResolvedValue({ tier: 'pro', tierLabel: 'Pro' })
    const { GET } = await import('@/app/api/plan/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signedIn).toBe(true)
    expect(body.tier).toBe('pro')
  })

  it('falls back to the safe Hobbyist default (still 200, signedIn:true) when the lib call throws', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    plan.getPlanStatus.mockRejectedValue(new Error('core unreachable'))
    const { GET } = await import('@/app/api/plan/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.signedIn).toBe(true)
    expect(body.tier).toBe('hobbyist')
  })
})

describe('#1202 GET /api/workspaces', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(noSession)
    const { GET } = await import('@/app/api/workspaces/route')

    const res = await GET()

    expect(res.status).toBe(401)
  })

  it('returns the workspace list when authenticated', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    workspaces.listWorkspaces.mockResolvedValue([{ id: 'w1', name: 'Acme', is_default: true }])
    const { GET } = await import('@/app/api/workspaces/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.workspaces).toHaveLength(1)
  })

  it('maps a 502 for a non-AINativeApiError failure', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    workspaces.listWorkspaces.mockRejectedValue(new Error('network blip'))
    const { GET } = await import('@/app/api/workspaces/route')

    const res = await GET()

    expect(res.status).toBe(502)
  })

  it('maps an AINativeApiError to its own status code', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { AINativeApiError } = await import('@/lib/ainative/types')
    workspaces.listWorkspaces.mockRejectedValue(new AINativeApiError('forbidden', 403))
    const { GET } = await import('@/app/api/workspaces/route')

    const res = await GET()

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })
})

describe('#1202 POST /api/workspaces', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(noSession)
    const { POST } = await import('@/app/api/workspaces/route')

    const res = await POST(mockJsonRequest('http://localhost/api/workspaces', { name: 'Acme' }))

    expect(res.status).toBe(401)
  })

  it('returns 400 when name is missing from the body', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { POST } = await import('@/app/api/workspaces/route')

    const res = await POST(mockJsonRequest('http://localhost/api/workspaces', {}))

    expect(res.status).toBe(400)
  })

  it('creates a workspace and returns 201 on success', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    workspaces.createWorkspace.mockResolvedValue({ id: 'w2', name: 'Acme' })
    const { POST } = await import('@/app/api/workspaces/route')

    const res = await POST(mockJsonRequest('http://localhost/api/workspaces', { name: 'Acme' }))

    expect(res.status).toBe(201)
    expect((await res.json()).workspace.id).toBe('w2')
  })

  it('surfaces a 403 workspace_limit_reached as an upgrade signal, not a raw error', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { AINativeApiError } = await import('@/lib/ainative/types')
    workspaces.createWorkspace.mockRejectedValue(new AINativeApiError('limit reached', 403))
    const { POST } = await import('@/app/api/workspaces/route')

    const res = await POST(mockJsonRequest('http://localhost/api/workspaces', { name: 'Acme' }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.upgradeRequired).toBe(true)
    expect(body.reason).toBe('workspace_limit_reached')
  })

  it('tolerates a malformed JSON body (falls through to the missing-name 400)', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { POST } = await import('@/app/api/workspaces/route')
    const req = mockGetRequest('http://localhost/api/workspaces')
    Object.defineProperty(req, 'json', { value: () => Promise.reject(new Error('bad json')) })

    const res = await POST(req as any)

    expect(res.status).toBe(400)
  })
})

describe('#1202 GET /api/projects', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(noSession)
    const { GET } = await import('@/app/api/projects/route')

    const res = await GET(mockGetRequest('http://localhost/api/projects'))

    expect(res.status).toBe(401)
  })

  it('lists all projects (no workspaceId filter) and includes tierUsage', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    projects.listProjects.mockResolvedValue([{ id: 'p1' }])
    const { GET } = await import('@/app/api/projects/route')

    const res = await GET(mockGetRequest('http://localhost/api/projects'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects).toHaveLength(1)
    expect(body.tierUsage.max).toBe(3)
    expect(projects.listProjectsForWorkspace).not.toHaveBeenCalled()
  })

  it('scopes to a workspace when workspaceId is passed as a query param', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    projects.listProjectsForWorkspace.mockResolvedValue([{ id: 'p2' }])
    const { GET } = await import('@/app/api/projects/route')

    const res = await GET(mockGetRequest('http://localhost/api/projects?workspaceId=w1'))

    expect(res.status).toBe(200)
    expect(projects.listProjectsForWorkspace).toHaveBeenCalledWith('test-access-token', 'w1')
    expect(projects.listProjects).not.toHaveBeenCalled()
  })

  it('maps a 502 for a non-AINativeApiError failure', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    projects.listProjects.mockRejectedValue(new Error('network blip'))
    const { GET } = await import('@/app/api/projects/route')

    const res = await GET(mockGetRequest('http://localhost/api/projects'))

    expect(res.status).toBe(502)
  })
})

describe('#1202 POST /api/projects', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(noSession)
    const { POST } = await import('@/app/api/projects/route')

    const res = await POST(mockJsonRequest('http://localhost/api/projects', { name: 'App' }))

    expect(res.status).toBe(401)
  })

  it('returns 400 when name is missing', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { POST } = await import('@/app/api/projects/route')

    const res = await POST(mockJsonRequest('http://localhost/api/projects', {}))

    expect(res.status).toBe(400)
  })

  it('creates a project and returns 201, resolving organizationId from the body', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    projects.createProject.mockResolvedValue({ id: 'p3', name: 'App' })
    const { POST } = await import('@/app/api/projects/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/projects', { name: 'App', organizationId: 'org-1' })
    )

    expect(res.status).toBe(201)
    expect(projects.createProject).toHaveBeenCalledWith(
      'test-access-token',
      expect.objectContaining({ name: 'App', organization_id: 'org-1' })
    )
  })

  it('falls back to the session workspaceId when no organizationId/workspaceId is in the body', async () => {
    auth.auth.mockResolvedValue(fakeSession({ workspaceId: 'session-ws' }))
    projects.createProject.mockResolvedValue({ id: 'p4' })
    const { POST } = await import('@/app/api/projects/route')

    await POST(mockJsonRequest('http://localhost/api/projects', { name: 'App' }))

    expect(projects.createProject).toHaveBeenCalledWith(
      'test-access-token',
      expect.objectContaining({ organization_id: 'session-ws' })
    )
  })

  it('surfaces a 403 project_limit_reached as an upgrade signal', async () => {
    auth.auth.mockResolvedValue(fakeSession())
    const { AINativeApiError } = await import('@/lib/ainative/types')
    projects.createProject.mockRejectedValue(new AINativeApiError('limit reached', 403))
    const { POST } = await import('@/app/api/projects/route')

    const res = await POST(mockJsonRequest('http://localhost/api/projects', { name: 'App' }))

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.upgradeRequired).toBe(true)
    expect(body.reason).toBe('project_limit_reached')
  })
})
