import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/build/ask — chat handoff summary wiring (#608). The GET already
 * rehydrates the thread on mount (#52); this adds a "where we left off"
 * summary alongside it, regenerated only when ensureChatSummary's own policy
 * warrants it.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  loadChatWithFallback: vi.fn(),
  ensureChatSummary: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/chat-store', () => ({
  deriveOwnerKey: () => 'guest:anon',
  chatScopeKey: (owner: string, slug: string) => `${owner}::${slug}`,
  loadChatWithFallback: h.loadChatWithFallback,
  saveExchange: vi.fn(),
  buildMessagesWithHistory: (history: any[], q: string) => [...history, { role: 'user', content: q }],
}))
vi.mock('@/lib/build/chat-summary', () => ({ ensureChatSummary: h.ensureChatSummary }))

import { GET } from '@/app/api/build/ask/route'

function req(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  h.resolveApp.mockResolvedValue(null)
})

describe('GET /api/build/ask — chat summary (#608)', () => {
  it('returns the summary alongside turns when one exists', async () => {
    h.loadChatWithFallback.mockResolvedValue([{ role: 'user', text: 'hi', createdAt: '' }])
    h.ensureChatSummary.mockResolvedValue({ summary: 'The founder asked for a headline change; Cody shipped it.', turnsCovered: 2, updatedAt: '' })

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box&companyName=Ember%20Box&idea=hot%20sauce'))
    const json = await res.json()

    expect(json.summary).toBe('The founder asked for a headline change; Cody shipped it.')
    expect(h.ensureChatSummary).toHaveBeenCalledWith('guest:anon::ember-box', 'Ember Box', 'hot sauce', expect.any(Array))
  })

  it('returns summary: null when none exists yet', async () => {
    h.loadChatWithFallback.mockResolvedValue([])
    h.ensureChatSummary.mockResolvedValue(null)

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()
    expect(json.summary).toBeNull()
  })

  it('returns an empty thread with no summary attempt when there is no companyId', async () => {
    const res = await GET(req('https://x/api/build/ask'))
    const json = await res.json()
    expect(json.turns).toEqual([])
    expect(h.ensureChatSummary).not.toHaveBeenCalled()
  })

  it('never fails the thread load when ensureChatSummary itself throws', async () => {
    h.loadChatWithFallback.mockResolvedValue([{ role: 'user', text: 'hi', createdAt: '' }])
    h.ensureChatSummary.mockRejectedValue(new Error('llm down'))

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()
    expect(json.turns).toHaveLength(1)
    expect(json.summary).toBeNull()
  })
})
