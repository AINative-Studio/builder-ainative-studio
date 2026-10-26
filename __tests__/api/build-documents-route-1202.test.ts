import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1202 (Coverage Phase 2 follow-up) — app/api/build/documents/route.ts (#64)
 * had zero route-level coverage. The module constructs an OpenAI client at
 * import time (the AINative fallback), so that's mocked too — nothing here
 * makes a real network/Claude/ZeroDB call.
 */

const auth = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/app/(auth)/auth', () => ({ auth: auth.auth }))

const completion = vi.hoisted(() => ({ completeText: vi.fn() }))
vi.mock('@/lib/build/claude-completion', () => ({ completeText: completion.completeText }))

const openaiCreate = vi.hoisted(() => vi.fn())
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } }
  },
}))

const docStore = vi.hoisted(() => ({
  createDocument: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  countByKind: vi.fn((docs: any[]) => ({ all: docs.length, document: 0, report: 0 })),
  filterByTab: vi.fn((docs: any[]) => docs),
  toSummary: vi.fn((d: any) => ({ id: d.id, title: d.title })),
  normalizeType: vi.fn((t: any) => t || 'research'),
  isDocTab: vi.fn(() => true),
  DOC_KINDS: ['document', 'report'],
}))
vi.mock('@/lib/build/document-store', () => docStore)

const docPrompts = vi.hoisted(() => ({
  DOCUMENT_PROMPTS: {
    research: {
      system: 'sys',
      user: (ctx: any) => `user:${ctx.idea}`,
      title: (ctx: any) => `Research for ${ctx.companyName}`,
    },
  },
  isGeneratableDocType: vi.fn((t: string) => t === 'research'),
  // Real implementation (not a stub) so #1540's bare-name-idea guard is
  // actually exercised by these route tests, not just unit-tested in
  // isolation — the route's own idea.length<3 check is a pure string guard
  // too, so this keeps the same fidelity.
  isBareNameIdea: (idea: string, companyName: string) => {
    const name = companyName.trim().toLowerCase()
    if (!name) return false
    const nameWords = new Set(name.split(/\W+/).filter(Boolean))
    const filler = new Set(['a', 'an', 'the', 'is', 'called', 'company', 'inc', 'llc', 'co', 'startup', 'app', 'product', 'for', 'business', 'named'])
    const ideaWords = idea.toLowerCase().split(/\W+/).filter(Boolean)
    if (ideaWords.length === 0) return false
    return ideaWords.every((w) => nameWords.has(w) || filler.has(w))
  },
}))
vi.mock('@/lib/build/document-prompts', () => docPrompts)

vi.mock('@/lib/build/env-keys', () => ({ getAinativeApiKey: () => 'test-key' }))

import { mockGetRequest, mockJsonRequest } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
  docStore.isDocTab.mockReturnValue(true)
  docStore.normalizeType.mockImplementation((t: any) => t || 'research')
  docPrompts.isGeneratableDocType.mockImplementation((t: string) => t === 'research')
})

describe('#1202 GET /api/build/documents', () => {
  it('returns an empty library when companyId is missing (no scope)', async () => {
    const { GET } = await import('@/app/api/build/documents/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/documents'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documents).toEqual([])
  })

  it('returns 404 when fetching a single document that does not exist', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.getDocument.mockResolvedValue(null)
    const { GET } = await import('@/app/api/build/documents/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/documents?companyId=acme&id=doc-1'))

    expect(res.status).toBe(404)
  })

  it('returns a single document when found', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.getDocument.mockResolvedValue({ id: 'doc-1', title: 'Research' })
    const { GET } = await import('@/app/api/build/documents/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/documents?companyId=acme&id=doc-1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.document).toEqual({ id: 'doc-1', title: 'Research' })
  })

  it('lists documents with counts and kind metadata', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.listDocuments.mockResolvedValue([{ id: 'd1', title: 'A', kind: 'document' }])
    const { GET } = await import('@/app/api/build/documents/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/documents?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documents).toEqual([{ id: 'd1', title: 'A' }])
    expect(body.kinds).toEqual(expect.arrayContaining([{ kind: 'all', label: 'All' }]))
  })

  it('degrades to an empty list when the store throws', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.listDocuments.mockRejectedValue(new Error('zerodb down'))
    const { GET } = await import('@/app/api/build/documents/route')

    const res = await GET(mockGetRequest('http://localhost/api/build/documents?companyId=acme'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.documents).toEqual([])
  })
})

describe('#1202 POST /api/build/documents', () => {
  it('returns 400 when companyId is missing', async () => {
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(mockJsonRequest('http://localhost/api/build/documents', { title: 'x', content: 'y' }))

    expect(res.status).toBe(400)
  })

  it('mode B: returns 400 when title is missing', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', { companyId: 'acme', content: 'body text' })
    )

    expect(res.status).toBe(400)
  })

  it('mode B: returns 400 when content is missing', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', { companyId: 'acme', title: 'My doc' })
    )

    expect(res.status).toBe(400)
  })

  it('mode B: persists a caller-authored document and returns it', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.createDocument.mockResolvedValue({ id: 'doc-2', title: 'My doc' })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        title: 'My doc',
        content: 'body text',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.document).toEqual({ id: 'doc-2', title: 'My doc' })
  })

  it('mode B: returns 502 when persistence fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docStore.createDocument.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        title: 'My doc',
        content: 'body text',
      })
    )

    expect(res.status).toBe(502)
  })

  it('mode A: returns 400 for a non-generatable type', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    docPrompts.isGeneratableDocType.mockReturnValue(false)
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        generate: true,
        type: 'daily-report',
        idea: 'A coffee shop finder',
      })
    )

    expect(res.status).toBe(400)
  })

  it('mode A: returns 400 when idea is too short', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        generate: true,
        type: 'research',
        idea: 'a',
      })
    )

    expect(res.status).toBe(400)
  })

  it('mode A: returns 422 when the idea is just the company name, not a real description (#1540)', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'silo',
        companyName: 'silo',
        generate: true,
        type: 'research',
        idea: 'silo',
      })
    )

    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('idea_too_sparse_to_ground')
    expect(docStore.createDocument).not.toHaveBeenCalled()
    expect(completion.completeText).not.toHaveBeenCalled()
  })

  it('mode A: a real (if short) idea that is not just the company name still generates (#1540 non-regression)', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    completion.completeText.mockResolvedValue({ text: 'A real generated research document body, written out fully.' })
    docStore.createDocument.mockResolvedValue({ id: 'doc-4', title: 'Research for wallkind' })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'wallkind',
        companyName: 'wallkind',
        generate: true,
        type: 'research',
        idea: 'street art gallery',
      })
    )

    expect(res.status).toBe(200)
    expect(docStore.createDocument).toHaveBeenCalledTimes(1)
  })

  it('mode A: generates via the primary Claude stack and persists', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    completion.completeText.mockResolvedValue({ text: 'A real generated research document body, written out fully.' })
    docStore.createDocument.mockResolvedValue({ id: 'doc-3', title: 'Research for Acme' })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        companyName: 'Acme',
        generate: true,
        type: 'research',
        idea: 'A coffee shop finder app',
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.document).toEqual({ id: 'doc-3', title: 'Research for Acme' })
    expect(completion.completeText).toHaveBeenCalled()
  })

  it('mode A: falls back to AINative chat-completions when the primary stack fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    completion.completeText.mockRejectedValue(new Error('bedrock timeout'))
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'A fallback-generated research document body.' } }],
    })
    docStore.createDocument.mockResolvedValue({ id: 'doc-4', title: 'Research for Acme' })
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        companyName: 'Acme',
        generate: true,
        type: 'research',
        idea: 'A coffee shop finder app',
      })
    )

    expect(res.status).toBe(200)
    expect(openaiCreate).toHaveBeenCalled()
  })

  it('mode A: returns 503 when every provider fails to produce usable content', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    completion.completeText.mockRejectedValue(new Error('bedrock timeout'))
    openaiCreate.mockRejectedValue(new Error('ainative down'))
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        generate: true,
        type: 'research',
        idea: 'A coffee shop finder app',
      })
    )

    expect(res.status).toBe(503)
  })

  it('mode A: returns 502 when generation succeeds but persistence fails', async () => {
    auth.auth.mockResolvedValue({ user: { email: 'founder@x.com' } })
    completion.completeText.mockResolvedValue({ text: 'A real generated research document body, written out fully.' })
    docStore.createDocument.mockResolvedValue(null)
    const { POST } = await import('@/app/api/build/documents/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/build/documents', {
        companyId: 'acme',
        generate: true,
        type: 'research',
        idea: 'A coffee shop finder app',
      })
    )

    expect(res.status).toBe(502)
  })
})
