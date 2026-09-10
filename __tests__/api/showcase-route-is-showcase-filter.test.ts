import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real bug found live (2026-09-10): `is_showcase` was already computed
 * correctly at persist time (generation-persist.ts: status==='success' &&
 * valid && length>=2000, and skipShowcase for internal/test traffic) and
 * stored on every generation row — but GET /api/showcase never read it,
 * relying purely on isQualityApp's much weaker length/shape check. That let
 * dozens of syntactically-valid-but-degraded/broken/internal-test
 * generations flood the public showcase (confirmed live: an App-track
 * invoicing test that fell back to fake /api/db calls was still marked
 * showcase-eligible). `is_showcase === true` (or legacy undefined) is now
 * the primary gate; isQualityApp is an ADDITIONAL structural check, not a
 * substitute.
 */

const h = vi.hoisted(() => ({
  listGenerations: vi.fn(async (): Promise<any[]> => []),
}))

vi.mock('@/lib/zerodb-store', () => ({ listGenerations: h.listGenerations }))
vi.mock('@/lib/showcase-store', () => ({
  getDynamicShowcase: () => [],
  addToShowcase: vi.fn(),
}))

import { GET } from '@/app/api/showcase/route'

function req(url = 'https://builder.ainative.studio/api/showcase') {
  return { url } as any
}

const bigValidCode = 'function App() { return <div>Real content</div> }; '.repeat(60)

function row(overrides: Record<string, any> = {}) {
  return {
    chat_id: 'chat-1',
    prompt: 'Build a polished, working web app for this idea: a habit tracker. Make it interactive.',
    generated_code: bigValidCode,
    created_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('GET /api/showcase — respects is_showcase (2026-09-10 fix)', () => {
  beforeEach(() => { h.listGenerations.mockReset() })

  it('includes a row explicitly marked is_showcase: true', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'good', is_showcase: true })])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'good')).toBe(true)
  })

  it('excludes a row explicitly marked is_showcase: false, even with substantial real-looking code', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'degraded', is_showcase: false })])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'degraded')).toBe(false)
  })

  it('excludes internal/test-marked generations (is_showcase: false via skipShowcase)', async () => {
    // Simulates a verification/test generation persisted with skipShowcase:
    // true, which generation-persist.ts turns into is_showcase: false.
    h.listGenerations.mockResolvedValue([row({ chat_id: 'internal-test', is_showcase: false })])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'internal-test')).toBe(false)
  })

  it('keeps legacy rows with is_showcase undefined (pre-dates the field), still subject to isQualityApp', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'legacy' })]) // no is_showcase key at all
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'legacy')).toBe(true)
  })

  it('still applies isQualityApp on top of is_showcase: true (structural check is not bypassed)', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'too-short', is_showcase: true, generated_code: 'const x = 1' })])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'too-short')).toBe(false)
  })

  it('uses the real extracted idea as the title, not the generic wrapper', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'titled', is_showcase: true })])
    const res = await GET(req())
    const data = await res.json()
    const entry = data.entries.find((e: any) => e.chatId === 'titled')
    expect(entry).toBeDefined()
    expect(entry.title.toLowerCase()).not.toContain('polished')
    expect(entry.title.toLowerCase()).toContain('habit tracker')
  })
})
