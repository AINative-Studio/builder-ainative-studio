import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — four skills sub-routes had zero coverage:
 * GET /api/skills/search, POST /api/skills/recommend,
 * POST /api/skills/[skillId]/rating, POST /api/skills/[skillId]/usage.
 * search/recommend go through the AgentSkillService singleton; rating/usage
 * go straight to lib/db/queries. Both boundaries are mocked.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const skillService = vi.hoisted(() => ({
  searchSkills: vi.fn(),
  recommendSkills: vi.fn(),
}))
vi.mock('@/lib/services/agent-skill.service', () => ({
  getSkillService: () => skillService,
}))

const queries = vi.hoisted(() => ({
  getSkillById: vi.fn(),
  upsertSkillRating: vi.fn(),
  trackSkillUsage: vi.fn(),
}))
vi.mock('@/lib/db/queries', () => queries)

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

const session = { user: { id: 'user-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  auth.auth.mockResolvedValue(session)
})

describe('#1202 GET /api/skills/search', () => {
  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/skills/search/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills/search'))

    expect(res.status).toBe(401)
  })

  it('searches with parsed query params and defaults', async () => {
    skillService.searchSkills.mockResolvedValue({ skills: [{ id: 's1' }], total: 1 })
    const { GET } = await import('@/app/api/skills/search/route')

    const res = await GET(
      mockGetRequest(
        'http://localhost/api/skills/search?query=test&tags=a,b&minRating=4&sortBy=rating'
      )
    )

    expect(res.status).toBe(200)
    expect(skillService.searchSkills).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'test', tags: ['a', 'b'], minRating: 4, sortBy: 'rating' })
    )
  })

  it('applies default limit/offset/sortBy when absent', async () => {
    skillService.searchSkills.mockResolvedValue({ skills: [], total: 0 })
    const { GET } = await import('@/app/api/skills/search/route')

    await GET(mockGetRequest('http://localhost/api/skills/search'))

    expect(skillService.searchSkills).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'relevance', limit: 50, offset: 0 })
    )
  })

  it('returns 500 when the service throws', async () => {
    skillService.searchSkills.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/skills/search/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills/search'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/skills/recommend', () => {
  const validBody = { sessionId: 'sess-1' }

  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/skills/recommend/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills/recommend', validBody))

    expect(res.status).toBe(401)
  })

  it('returns 400 when sessionId is missing (zod validation failure)', async () => {
    const { POST } = await import('@/app/api/skills/recommend/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills/recommend', {}))

    expect(res.status).toBe(400)
  })

  it('returns recommendations for a valid context', async () => {
    skillService.recommendSkills.mockResolvedValue([{ skillId: 's1', score: 0.9 }])
    const { POST } = await import('@/app/api/skills/recommend/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills/recommend', validBody))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.recommendations).toHaveLength(1)
    expect(skillService.recommendSkills).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', sessionId: 'sess-1' })
    )
  })

  it('returns 500 when the service throws a non-zod error', async () => {
    skillService.recommendSkills.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/skills/recommend/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills/recommend', validBody))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/skills/[skillId]/rating', () => {
  const validBody = { rating: 5 }

  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/skills/[skillId]/rating/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/rating', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when the rating is out of range', async () => {
    const { POST } = await import('@/app/api/skills/[skillId]/rating/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/rating', { rating: 7 }),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when the skill does not exist', async () => {
    queries.getSkillById.mockResolvedValue(null)
    const { POST } = await import('@/app/api/skills/[skillId]/rating/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/rating', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(404)
  })

  it('upserts the rating and returns 200 on success', async () => {
    queries.getSkillById.mockResolvedValue({ id: 's1' })
    queries.upsertSkillRating.mockResolvedValue([{ id: 'r1', rating: 5 }])
    const { POST } = await import('@/app/api/skills/[skillId]/rating/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/rating', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rating).toEqual({ id: 'r1', rating: 5 })
  })

  it('returns 500 when the lookup throws', async () => {
    queries.getSkillById.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/skills/[skillId]/rating/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/rating', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/skills/[skillId]/usage', () => {
  const validBody = {
    loadType: 'manual',
    loadTimeMs: 100,
    metadataLoaded: true,
    contentLoaded: true,
    referencesLoaded: false,
    tokensUsed: 50,
  }

  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/skills/[skillId]/usage/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/usage', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(401)
  })

  it('returns 400 when loadType is invalid', async () => {
    const { POST } = await import('@/app/api/skills/[skillId]/usage/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/usage', { ...validBody, loadType: 'bogus' }),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 404 when the skill does not exist', async () => {
    queries.getSkillById.mockResolvedValue(null)
    const { POST } = await import('@/app/api/skills/[skillId]/usage/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/usage', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(404)
  })

  it('tracks usage and returns 201 on success', async () => {
    queries.getSkillById.mockResolvedValue({ id: 's1' })
    queries.trackSkillUsage.mockResolvedValue([{ id: 'u1' }])
    const { POST } = await import('@/app/api/skills/[skillId]/usage/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/usage', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(201)
  })

  it('returns 500 when tracking throws', async () => {
    queries.getSkillById.mockResolvedValue({ id: 's1' })
    queries.trackSkillUsage.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/skills/[skillId]/usage/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/skills/s1/usage', validBody),
      mockParams({ skillId: 's1' })
    )

    expect(res.status).toBe(500)
  })
})
