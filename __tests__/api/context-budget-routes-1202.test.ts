import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — the context-budget endpoints had zero route-level
 * coverage: GET /api/context/budget and POST /api/context/{optimize,
 * preload-cost,track,unload}. All five call into the same
 * `contextBudgetService` singleton; the budget route also queries
 * `context_items`/`budget_events` directly via `db.query`. Both are mocked at
 * the boundary — nothing here touches a real DB.
 */

const service = vi.hoisted(() => ({
  getBudget: vi.fn(),
  getOptimizationSuggestions: vi.fn(),
  calculatePreLoadCost: vi.fn(),
  trackItem: vi.fn(),
  getItemById: vi.fn(),
}))

vi.mock('@/lib/services/context-budget.service', () => ({
  contextBudgetService: service,
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const dbMock = vi.hoisted(() => ({
  query: {
    context_items: { findMany: vi.fn() },
    budget_events: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/db', () => ({ db: dbMock }))

vi.mock('@/lib/db/schema', () => ({
  context_items: { session_id: 'session_id', status: 'status' },
  budget_events: { session_id: 'session_id', created_at: 'created_at' },
}))

import { mockGetRequest, mockJsonRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.query.context_items.findMany.mockResolvedValue([])
  dbMock.query.budget_events.findMany.mockResolvedValue([])
})

describe('#1202 GET /api/context/budget', () => {
  it('returns 400 when sessionId or userId is missing', async () => {
    const { GET } = await import('@/app/api/context/budget/route')

    const res = await GET(mockGetRequest('http://localhost/api/context/budget'))

    expect(res.status).toBe(400)
  })

  it('returns the budget and items for a valid session/user', async () => {
    service.getBudget.mockResolvedValue({ used: 100, total: 1000 })
    dbMock.query.context_items.findMany.mockResolvedValue([
      { id: 'i1', type: 'file', name: 'a.ts', token_cost: 10, priority: 'high', status: 'loaded' },
    ])
    const { GET } = await import('@/app/api/context/budget/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/context/budget?sessionId=s1&userId=u1')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.items).toHaveLength(1)
    expect(body.suggestions).toBeUndefined()
    expect(body.history).toBeUndefined()
  })

  it('includes suggestions when includeSuggestions=true', async () => {
    service.getBudget.mockResolvedValue({ used: 100, total: 1000 })
    service.getOptimizationSuggestions.mockResolvedValue([{ id: 'sug-1', estimatedSavings: 50 }])
    const { GET } = await import('@/app/api/context/budget/route')

    const res = await GET(
      mockGetRequest(
        'http://localhost/api/context/budget?sessionId=s1&userId=u1&includeSuggestions=true'
      )
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.suggestions).toHaveLength(1)
    expect(service.getOptimizationSuggestions).toHaveBeenCalledWith('s1', 'u1', 'moderate')
  })

  it('includes history when includeHistory=true', async () => {
    service.getBudget.mockResolvedValue({ used: 100, total: 1000 })
    dbMock.query.budget_events.findMany.mockResolvedValue([
      { id: 'e1', session_id: 's1', user_id: 'u1', event_type: 'load', created_at: 'now' },
    ])
    const { GET } = await import('@/app/api/context/budget/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/context/budget?sessionId=s1&userId=u1&includeHistory=true')
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history).toHaveLength(1)
  })

  it('returns 500 when the service throws', async () => {
    service.getBudget.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/context/budget/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/context/budget?sessionId=s1&userId=u1')
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/context/optimize', () => {
  it('returns 400 when sessionId or userId is missing', async () => {
    const { POST } = await import('@/app/api/context/optimize/route')

    const res = await POST(mockJsonRequest('http://localhost/api/context/optimize', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid aggressiveness value', async () => {
    const { POST } = await import('@/app/api/context/optimize/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/optimize', {
        sessionId: 's1',
        userId: 'u1',
        aggressiveness: 'extreme',
      })
    )

    expect(res.status).toBe(400)
  })

  it('returns suggestions with estimated/target usage using a provided targetReduction', async () => {
    service.getBudget.mockResolvedValue({ used: 500 })
    service.getOptimizationSuggestions.mockResolvedValue([
      { estimatedSavings: 20 },
      { estimatedSavings: 30 },
    ])
    const { POST } = await import('@/app/api/context/optimize/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/optimize', {
        sessionId: 's1',
        userId: 'u1',
        targetReduction: 100,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.estimatedSavings).toBe(50)
    expect(body.currentUsage).toBe(500)
    expect(body.targetUsage).toBe(400)
  })

  it('falls back to estimatedSavings for targetUsage when no targetReduction given', async () => {
    service.getBudget.mockResolvedValue({ used: 500 })
    service.getOptimizationSuggestions.mockResolvedValue([{ estimatedSavings: 600 }])
    const { POST } = await import('@/app/api/context/optimize/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/optimize', { sessionId: 's1', userId: 'u1' })
    )

    const body = await res.json()
    // used (500) - estimatedSavings (600) would be negative, clamped to 0
    expect(body.targetUsage).toBe(0)
  })

  it('returns 500 when the service throws', async () => {
    service.getBudget.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/context/optimize/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/optimize', { sessionId: 's1', userId: 'u1' })
    )

    expect(res.status).toBe(500)
  })
})

const validItem = { type: 'file', name: 'a.ts', tokenCost: 10, priority: 'high' }

describe('#1202 POST /api/context/preload-cost', () => {
  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/context/preload-cost/route')

    const res = await POST(mockJsonRequest('http://localhost/api/context/preload-cost', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 when item structure is invalid', async () => {
    const { POST } = await import('@/app/api/context/preload-cost/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/preload-cost', {
        sessionId: 's1',
        userId: 'u1',
        item: { type: 'file' }, // missing name/tokenCost/priority
      })
    )

    expect(res.status).toBe(400)
  })

  it('returns the calculated pre-load cost on a valid request', async () => {
    service.calculatePreLoadCost.mockResolvedValue({ canLoad: true, cost: 10 })
    const { POST } = await import('@/app/api/context/preload-cost/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/preload-cost', {
        sessionId: 's1',
        userId: 'u1',
        item: validItem,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.preLoadCost).toEqual({ canLoad: true, cost: 10 })
  })

  it('returns 500 when the service throws', async () => {
    service.calculatePreLoadCost.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/context/preload-cost/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/preload-cost', {
        sessionId: 's1',
        userId: 'u1',
        item: validItem,
      })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/context/track', () => {
  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/context/track/route')

    const res = await POST(mockJsonRequest('http://localhost/api/context/track', {}))

    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid action', async () => {
    const { POST } = await import('@/app/api/context/track/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/track', {
        sessionId: 's1',
        userId: 'u1',
        item: validItem,
        action: 'teleport',
      })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when item structure is invalid', async () => {
    const { POST } = await import('@/app/api/context/track/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/track', {
        sessionId: 's1',
        userId: 'u1',
        item: { type: 'file' },
        action: 'load',
      })
    )

    expect(res.status).toBe(400)
  })

  it('tracks a valid item and returns the result', async () => {
    service.trackItem.mockResolvedValue({
      item: { id: 'i1' },
      budget: { used: 10 },
      warnings: [],
    })
    const { POST } = await import('@/app/api/context/track/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/track', {
        sessionId: 's1',
        userId: 'u1',
        item: validItem,
        action: 'load',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.item).toEqual({ id: 'i1' })
  })

  it('returns 500 when the service throws', async () => {
    service.trackItem.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/context/track/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/track', {
        sessionId: 's1',
        userId: 'u1',
        item: validItem,
        action: 'load',
      })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/context/unload', () => {
  it('returns 400 when itemIds is missing or not an array', async () => {
    const { POST } = await import('@/app/api/context/unload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/unload', { sessionId: 's1', userId: 'u1' })
    )

    expect(res.status).toBe(400)
  })

  it('returns 400 when itemIds is an empty array', async () => {
    const { POST } = await import('@/app/api/context/unload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/unload', {
        sessionId: 's1',
        userId: 'u1',
        itemIds: [],
      })
    )

    expect(res.status).toBe(400)
  })

  it('unloads items that exist and skips items that do not', async () => {
    service.getItemById
      .mockResolvedValueOnce({
        id: 'i1',
        type: 'file',
        name: 'a.ts',
        tokenCost: 10,
        priority: 'high',
        status: 'loaded',
        metadata: {},
      })
      .mockResolvedValueOnce(null)
    service.trackItem.mockResolvedValue({ item: { id: 'i1', status: 'unloaded' } })
    service.getBudget.mockResolvedValue({ used: 0 })
    const { POST } = await import('@/app/api/context/unload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/unload', {
        sessionId: 's1',
        userId: 'u1',
        itemIds: ['i1', 'missing'],
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unloadedItems).toHaveLength(1)
    expect(body.tokensSaved).toBe(10)
  })

  it('continues past a per-item failure and still returns 200', async () => {
    service.getItemById.mockRejectedValueOnce(new Error('lookup failed'))
    service.getBudget.mockResolvedValue({ used: 0 })
    const { POST } = await import('@/app/api/context/unload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/unload', {
        sessionId: 's1',
        userId: 'u1',
        itemIds: ['i1'],
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.unloadedItems).toHaveLength(0)
  })

  it('returns 500 when the final getBudget call throws', async () => {
    service.getItemById.mockResolvedValue(null)
    service.getBudget.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/context/unload/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/context/unload', {
        sessionId: 's1',
        userId: 'u1',
        itemIds: ['i1'],
      })
    )

    expect(res.status).toBe(500)
  })
})
