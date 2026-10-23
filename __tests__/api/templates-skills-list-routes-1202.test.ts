import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2) — GET /api/templates (filter/sort/pagination
 * query-building, no auth gate) and GET+POST /api/skills (auth-gated,
 * zod-validated create) had no route-level coverage.
 */

const h = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
}))

vi.mock('@/lib/db', () => {
  const chain: any = {
    select: (...a: any[]) => {
      h.select(...a)
      return chain
    },
    from: (...a: any[]) => {
      h.from(...a)
      return chain
    },
    where: (...a: any[]) => {
      h.where(...a)
      return chain
    },
    orderBy: (...a: any[]) => {
      h.orderBy(...a)
      return chain
    },
    limit: (...a: any[]) => {
      h.limit(...a)
      return chain
    },
    offset: (...a: any[]) => h.offset(...a),
  }
  return { db: chain }
})

vi.mock('@/lib/db/schema', () => ({
  templates: {
    is_active: 'is_active',
    category: 'category',
    name: 'name',
    description: 'description',
    metadata: 'metadata',
    tags: 'tags',
    usage_count: 'usage_count',
    created_at: 'created_at',
  },
}))

import { mockGetRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
  // Promise.all([templateList, countResult]) — the chain's terminal `offset`
  // call resolves the list; `where` resolves the count query's final link.
  // Both calls run through the SAME mocked chain object (one query builder
  // per real drizzle call), so give both terminal methods a resolved array.
  h.offset.mockResolvedValue([{ id: 't1', name: 'Landing Page' }])
})

describe('#1202 GET /api/templates', () => {
  it('lists templates with default pagination (page 1, limit 12)', async () => {
    const { GET } = await import('@/app/api/templates/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.templates).toHaveLength(1)
    expect(body.pagination.page).toBe(1)
    expect(body.pagination.limit).toBe(12)
  })

  it('applies category, search, complexity, and tags filters together', async () => {
    const { GET } = await import('@/app/api/templates/route')

    const res = await GET(
      mockGetRequest(
        'http://localhost/api/templates?category=saas&search=landing&complexity=simple&tags=ecommerce,crm&page=2&limit=5'
      )
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pagination.page).toBe(2)
    expect(body.pagination.limit).toBe(5)
  })

  it.each(['most-used', 'newest', 'a-z', 'unknown-sort-value'])(
    'accepts sort=%s without throwing',
    async (sort) => {
      const { GET } = await import('@/app/api/templates/route')

      const res = await GET(mockGetRequest(`http://localhost/api/templates?sort=${sort}`))

      expect(res.status).toBe(200)
    }
  )

  it('returns 500 (not a crash) when the DB query throws', async () => {
    h.offset.mockRejectedValueOnce(new Error('db down'))
    const { GET } = await import('@/app/api/templates/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates'))

    expect(res.status).toBe(500)
  })
})

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const queries = vi.hoisted(() => ({
  createSkill: vi.fn(),
  getAllActiveSkills: vi.fn(),
  getBuiltInSkills: vi.fn(),
}))
vi.mock('@/lib/db/queries', () => ({
  createSkill: queries.createSkill,
  getAllActiveSkills: queries.getAllActiveSkills,
  getBuiltInSkills: queries.getBuiltInSkills,
}))

const validSkillBody = {
  id: 'skill-1',
  name: 'Example Skill',
  description: 'Does something useful',
  version: '1.0.0',
  tags: ['example'],
  content: 'skill content',
}

describe('#1202 GET /api/skills', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/skills/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills'))

    expect(res.status).toBe(401)
  })

  it('returns all active skills by default', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    queries.getAllActiveSkills.mockResolvedValue([{ id: 'skill-1' }])
    const { GET } = await import('@/app/api/skills/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills'))

    expect(res.status).toBe(200)
    expect(queries.getBuiltInSkills).not.toHaveBeenCalled()
  })

  it('returns only built-in skills when builtInOnly=true', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    queries.getBuiltInSkills.mockResolvedValue([{ id: 'builtin-1' }])
    const { GET } = await import('@/app/api/skills/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills?builtInOnly=true'))

    expect(res.status).toBe(200)
    expect(queries.getAllActiveSkills).not.toHaveBeenCalled()
  })

  it('returns 500 when the query throws', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    queries.getAllActiveSkills.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/skills/route')

    const res = await GET(mockGetRequest('http://localhost/api/skills'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/skills', () => {
  it('returns 401 when there is no session', async () => {
    auth.auth.mockResolvedValue(null)
    const { mockJsonRequest } = await import('../helpers/api-route-harness')
    const { POST } = await import('@/app/api/skills/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills', validSkillBody))

    expect(res.status).toBe(401)
  })

  it('creates a skill and returns 201 when the body validates', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1', email: 'founder@example.com' } })
    queries.createSkill.mockResolvedValue([{ id: 'skill-1' }])
    const { mockJsonRequest } = await import('../helpers/api-route-harness')
    const { POST } = await import('@/app/api/skills/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills', validSkillBody))

    expect(res.status).toBe(201)
    expect(queries.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: 'user-1', authorEmail: 'founder@example.com' })
    )
  })

  it('returns 400 with validation details when version is not semver', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { mockJsonRequest } = await import('../helpers/api-route-harness')
    const { POST } = await import('@/app/api/skills/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills', { ...validSkillBody, version: 'v1' }))

    expect(res.status).toBe(400)
  })

  it('returns 500 when createSkill throws after validation passes', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    queries.createSkill.mockRejectedValue(new Error('db down'))
    const { mockJsonRequest } = await import('../helpers/api-route-harness')
    const { POST } = await import('@/app/api/skills/route')

    const res = await POST(mockJsonRequest('http://localhost/api/skills', validSkillBody))

    expect(res.status).toBe(500)
  })
})
