import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — three template sub-routes had zero coverage:
 * GET /api/templates/[id] (fetch + increment usage), GET /api/templates/
 * analytics (top templates + category breakdown), POST /api/templates/submit
 * (auth-gated, security-checked submission). All go through the drizzle `db`
 * client, mocked here the same way the already-covered GET /api/templates
 * test does.
 */

const h = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  orderBy: vi.fn(),
  groupBy: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
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
    limit: (...a: any[]) => h.limit(...a),
    orderBy: (...a: any[]) => {
      h.orderBy(...a)
      return chain
    },
    groupBy: (...a: any[]) => h.groupBy(...a),
    update: (...a: any[]) => {
      h.update(...a)
      return chain
    },
    set: (...a: any[]) => {
      h.set(...a)
      return chain
    },
    insert: (...a: any[]) => {
      h.insert(...a)
      return chain
    },
    values: (...a: any[]) => {
      h.values(...a)
      return chain
    },
    returning: (...a: any[]) => h.returning(...a),
  }
  return { db: chain }
})

vi.mock('@/lib/db/schema', () => ({
  templates: {
    id: 'id',
    name: 'name',
    category: 'category',
    usage_count: 'usage_count',
  },
  template_submissions: {},
}))

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: auth.auth }))

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/templates/[id]', () => {
  it('returns 404 when the template does not exist', async () => {
    h.limit.mockResolvedValue([])
    const { GET } = await import('@/app/api/templates/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/t1'), mockParams({ id: 't1' }))

    expect(res.status).toBe(404)
  })

  it('returns the template with an incremented usage count', async () => {
    h.limit.mockResolvedValue([{ id: 't1', name: 'Landing', usage_count: 5 }])
    h.set.mockReturnValue({ where: h.where })
    const { GET } = await import('@/app/api/templates/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/t1'), mockParams({ id: 't1' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.template.usage_count).toBe(6)
  })

  it('returns 500 when the lookup throws', async () => {
    h.limit.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/templates/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/t1'), mockParams({ id: 't1' }))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/templates/analytics', () => {
  it('returns the analytics payload with computed percentages', async () => {
    // First db.select(...).from(...).orderBy(...).limit(...) resolves topTemplates;
    // second db.select(...).from(...).groupBy(...) resolves categoryStats.
    h.limit.mockResolvedValueOnce([{ id: 't1', name: 'Landing', category: 'saas', usage_count: 5 }])
    h.groupBy.mockResolvedValueOnce([{ category: 'saas', count: 2, total_usage: 50 }])
    const { GET } = await import('@/app/api/templates/analytics/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/analytics'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalUsage).toBe(50)
    expect(body.categoryBreakdown[0]).toMatchObject({ category: 'saas', percentage: 100 })
  })

  it('handles zero total usage without dividing by zero', async () => {
    h.limit.mockResolvedValueOnce([])
    h.groupBy.mockResolvedValueOnce([])
    const { GET } = await import('@/app/api/templates/analytics/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/analytics'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalUsage).toBe(0)
  })

  it('returns 500 when the query throws', async () => {
    h.limit.mockRejectedValueOnce(new Error('db down'))
    const { GET } = await import('@/app/api/templates/analytics/route')

    const res = await GET(mockGetRequest('http://localhost/api/templates/analytics'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/templates/submit', () => {
  const validBody = {
    name: 'My Template',
    category: 'saas',
    description: 'A nice template',
    code: 'export default function App() { return null }',
  }

  it('returns 401 without a session', async () => {
    auth.auth.mockResolvedValue(null)
    const { POST } = await import('@/app/api/templates/submit/route')

    const res = await POST(mockJsonRequest('http://localhost/api/templates/submit', validBody))

    expect(res.status).toBe(401)
  })

  it('returns 400 when required fields are missing', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/templates/submit/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/templates/submit', { name: 'Only Name' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when the code has an external import', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    const { POST } = await import('@/app/api/templates/submit/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/templates/submit', {
        ...validBody,
        code: "import axios from 'axios'",
      })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/external imports/)
  })

  it('creates the submission and returns it on success', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.returning.mockResolvedValue([{ id: 'sub-1', status: 'pending' }])
    const { POST } = await import('@/app/api/templates/submit/route')

    const res = await POST(mockJsonRequest('http://localhost/api/templates/submit', validBody))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submission).toEqual({ id: 'sub-1', status: 'pending' })
  })

  it('returns 500 when the insert throws', async () => {
    auth.auth.mockResolvedValue({ user: { id: 'user-1' } })
    h.returning.mockRejectedValue(new Error('db down'))
    const { POST } = await import('@/app/api/templates/submit/route')

    const res = await POST(mockJsonRequest('http://localhost/api/templates/submit', validBody))

    expect(res.status).toBe(500)
  })
})
