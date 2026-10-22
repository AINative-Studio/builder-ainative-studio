import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — US-015 prompt version management routes had
 * zero route-level coverage: GET+POST /api/prompts, GET+PUT /api/prompts/
 * [id], PUT /api/prompts/[id]/activate. All three files call into
 * lib/services/prompt.service's exported functions directly (not a
 * singleton/factory), so each function is mocked individually.
 */

const promptService = vi.hoisted(() => ({
  getAllPrompts: vi.fn(),
  createPrompt: vi.fn(),
  getPromptById: vi.fn(),
  updatePrompt: vi.fn(),
  activatePrompt: vi.fn(),
}))

vi.mock('@/lib/services/prompt.service', () => promptService)

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1202 GET /api/prompts', () => {
  it('lists all prompts', async () => {
    promptService.getAllPrompts.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }])
    const { GET } = await import('@/app/api/prompts/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
  })

  it('returns 503 when the database is unavailable', async () => {
    promptService.getAllPrompts.mockRejectedValue(new Error('Database not available'))
    const { GET } = await import('@/app/api/prompts/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts'))

    expect(res.status).toBe(503)
  })

  it('returns 500 on any other error', async () => {
    promptService.getAllPrompts.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/prompts/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 POST /api/prompts', () => {
  const validBody = { type: 'system', version: '1.0.0', content: 'You are a helpful assistant' }

  it('returns 400 when validation fails', async () => {
    const { POST } = await import('@/app/api/prompts/route')

    const res = await POST(mockJsonRequest('http://localhost/api/prompts', { type: 'bogus' }))

    expect(res.status).toBe(400)
  })

  it('creates a prompt and returns 201 on success', async () => {
    promptService.createPrompt.mockResolvedValue({ id: 'p1', ...validBody })
    const { POST } = await import('@/app/api/prompts/route')

    const res = await POST(mockJsonRequest('http://localhost/api/prompts', validBody))

    expect(res.status).toBe(201)
  })

  it('returns 503 when the database is unavailable', async () => {
    promptService.createPrompt.mockRejectedValue(new Error('Database not available'))
    const { POST } = await import('@/app/api/prompts/route')

    const res = await POST(mockJsonRequest('http://localhost/api/prompts', validBody))

    expect(res.status).toBe(503)
  })

  it('returns 500 on any other error', async () => {
    promptService.createPrompt.mockRejectedValue(new Error('boom'))
    const { POST } = await import('@/app/api/prompts/route')

    const res = await POST(mockJsonRequest('http://localhost/api/prompts', validBody))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/prompts/[id]', () => {
  it('returns the prompt when found', async () => {
    promptService.getPromptById.mockResolvedValue({ id: 'p1' })
    const { GET } = await import('@/app/api/prompts/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts/p1'), mockParams({ id: 'p1' }))

    expect(res.status).toBe(200)
  })

  it('returns 404 when the prompt is not found', async () => {
    promptService.getPromptById.mockRejectedValue(new Error('Prompt not found'))
    const { GET } = await import('@/app/api/prompts/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts/p1'), mockParams({ id: 'p1' }))

    expect(res.status).toBe(404)
  })

  it('returns 503 when the database is unavailable', async () => {
    promptService.getPromptById.mockRejectedValue(new Error('Database not available'))
    const { GET } = await import('@/app/api/prompts/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts/p1'), mockParams({ id: 'p1' }))

    expect(res.status).toBe(503)
  })

  it('returns 500 on any other error', async () => {
    promptService.getPromptById.mockRejectedValue(new Error('boom'))
    const { GET } = await import('@/app/api/prompts/[id]/route')

    const res = await GET(mockGetRequest('http://localhost/api/prompts/p1'), mockParams({ id: 'p1' }))

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/prompts/[id]', () => {
  it('returns 400 when validation fails', async () => {
    const { PUT } = await import('@/app/api/prompts/[id]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1', { abTestPercentage: 200 }, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(400)
  })

  it('updates the prompt on success', async () => {
    promptService.updatePrompt.mockResolvedValue({ id: 'p1', content: 'new' })
    const { PUT } = await import('@/app/api/prompts/[id]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1', { content: 'new' }, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 404 when the prompt is not found', async () => {
    promptService.updatePrompt.mockRejectedValue(new Error('Prompt not found'))
    const { PUT } = await import('@/app/api/prompts/[id]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1', { content: 'new' }, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 503 when the database is unavailable', async () => {
    promptService.updatePrompt.mockRejectedValue(new Error('Database not available'))
    const { PUT } = await import('@/app/api/prompts/[id]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1', { content: 'new' }, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(503)
  })

  it('returns 500 on any other error', async () => {
    promptService.updatePrompt.mockRejectedValue(new Error('boom'))
    const { PUT } = await import('@/app/api/prompts/[id]/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1', { content: 'new' }, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 PUT /api/prompts/[id]/activate', () => {
  it('activates the prompt on success', async () => {
    promptService.activatePrompt.mockResolvedValue({ id: 'p1', isActive: true })
    const { PUT } = await import('@/app/api/prompts/[id]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1/activate', {}, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(200)
  })

  it('returns 404 when the prompt is not found', async () => {
    promptService.activatePrompt.mockRejectedValue(new Error('Prompt not found'))
    const { PUT } = await import('@/app/api/prompts/[id]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1/activate', {}, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(404)
  })

  it('returns 503 when the database is unavailable', async () => {
    promptService.activatePrompt.mockRejectedValue(new Error('Database not available'))
    const { PUT } = await import('@/app/api/prompts/[id]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1/activate', {}, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(503)
  })

  it('returns 500 on any other error', async () => {
    promptService.activatePrompt.mockRejectedValue(new Error('boom'))
    const { PUT } = await import('@/app/api/prompts/[id]/activate/route')

    const res = await PUT(
      mockJsonRequest('http://localhost/api/prompts/p1/activate', {}, { method: 'PUT' }),
      mockParams({ id: 'p1' })
    )

    expect(res.status).toBe(500)
  })
})
