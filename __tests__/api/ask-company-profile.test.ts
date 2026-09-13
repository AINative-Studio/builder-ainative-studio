import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * GET /api/build/ask — "what Cody has learned" company profile wiring
 * (#693). Alongside #608's chat summary, the GET now also calls
 * ensureCompanyProfile (real ZeroMemory reflect/profile synthesis),
 * regenerated only when its own policy warrants it.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveApp: vi.fn(),
  loadChatWithFallback: vi.fn(),
  ensureChatSummary: vi.fn(),
  ensureCompanyProfile: vi.fn(),
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
vi.mock('@/lib/build/company-profile', () => ({ ensureCompanyProfile: h.ensureCompanyProfile }))

import { GET } from '@/app/api/build/ask/route'

function req(url: string) {
  return { nextUrl: new URL(url) } as any
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset())
  h.auth.mockResolvedValue(null)
  h.resolveApp.mockResolvedValue(null)
  h.ensureChatSummary.mockResolvedValue(null)
})

describe('GET /api/build/ask — company profile (#693)', () => {
  it('returns the profile alongside turns and summary when one exists', async () => {
    h.loadChatWithFallback.mockResolvedValue([{ role: 'user', text: 'hi', createdAt: '' }])
    h.ensureCompanyProfile.mockResolvedValue({
      summary: 'A founder building Ledgerly who likes blue and async code.',
      preferences: ['likes blue'],
      behaviors: ['prefers async code'],
      facts: ['building Ledgerly'],
      memoryCount: 5,
      lastInteraction: '2026-09-12T23:40:02Z',
    })

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()

    expect(json.profile).toEqual({
      summary: 'A founder building Ledgerly who likes blue and async code.',
      preferences: ['likes blue'],
      behaviors: ['prefers async code'],
      facts: ['building Ledgerly'],
      memoryCount: 5,
      lastInteraction: '2026-09-12T23:40:02Z',
    })
    expect(h.ensureCompanyProfile).toHaveBeenCalledWith('guest:anon::ember-box')
  })

  it('returns profile: null when none exists yet', async () => {
    h.loadChatWithFallback.mockResolvedValue([])
    h.ensureCompanyProfile.mockResolvedValue(null)

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()
    expect(json.profile).toBeNull()
  })

  it('does not attempt a profile lookup when there is no companyId', async () => {
    const res = await GET(req('https://x/api/build/ask'))
    const json = await res.json()
    expect(json.turns).toEqual([])
    expect(h.ensureCompanyProfile).not.toHaveBeenCalled()
  })

  it('never fails the thread load when ensureCompanyProfile itself throws', async () => {
    h.loadChatWithFallback.mockResolvedValue([{ role: 'user', text: 'hi', createdAt: '' }])
    h.ensureCompanyProfile.mockRejectedValue(new Error('zeromemory down'))

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()
    expect(json.turns).toHaveLength(1)
    expect(json.profile).toBeNull()
  })

  it('the chat summary and company profile are independent — one failing never blocks the other', async () => {
    h.loadChatWithFallback.mockResolvedValue([{ role: 'user', text: 'hi', createdAt: '' }])
    h.ensureChatSummary.mockRejectedValue(new Error('llm down'))
    h.ensureCompanyProfile.mockResolvedValue({
      summary: 'Real profile.', preferences: [], behaviors: [], facts: [], memoryCount: 4, lastInteraction: null,
    })

    const res = await GET(req('https://x/api/build/ask?companyId=ember-box'))
    const json = await res.json()
    expect(json.summary).toBeNull()
    expect(json.profile?.summary).toBe('Real profile.')
  })
})
