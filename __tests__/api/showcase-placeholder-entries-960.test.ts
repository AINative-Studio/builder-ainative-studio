import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#960 — regression test built from the ACTUAL two bad rows found live
 * on the public /showcase (fetched from production 2026-10-06):
 *
 *   chat_id x6wOHR9rN8UDxcUyTXElZ → slug "slug-x6wOHR", title "{slug}`"
 *   chat_id 7W6siLoHGM8O4rsusuIQt → slug "slug-7W6siL", title "{slug}`"
 *
 * The prompts below are the real, verbatim prompts from those rows — i.e.
 * company-app/route.ts's and company-product/route.ts's own templates with
 * `name` and `idea` both equal to the literal string `{slug}` + a backtick.
 *
 * Both rows were persisted with is_showcase: true and pass isQualityApp, because
 * nothing was wrong with their CODE — only with the name/idea the generation was
 * asked for. So neither of the pre-existing gates could ever exclude them; this
 * read-time placeholder filter is what actually removes them.
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

// Verbatim from the live rows.
const LANDING_PROMPT =
  'Build a polished, production-quality single-page marketing LANDING PAGE for "{slug}`" — a real company for this idea: {slug}`. ' +
  'Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, a how-it-works section, pricing (3 tiers), ' +
  'and a footer. Use #2f6d86 as the main accent color. Make it visually distinctive and specific to this company, with realistic copy — not a generic template.'

const PRODUCT_PROMPT =
  'Build a real, working, functional application for "{slug}`" that actually implements this idea: {slug}`. ' +
  "This is the founder's REAL, WORKING TOOL — not a marketing page — build the core feature(s) a user would use every day: real data, " +
  'real interactions, real functionality that does what the idea describes. Compose whichever AINative primitives genuinely fit this ' +
  'specific idea (persistence, memory, pipeline, commerce, voice, etc.) and call their real APIs, not a hand-rolled substitute. ' +
  'Make it visually distinctive and specific to this company, with realistic data — not a generic template.'

function row(overrides: Record<string, any> = {}) {
  return {
    chat_id: 'chat-1',
    prompt: 'Build a polished, working web app for this idea: a habit tracker. Make it interactive.',
    generated_code: bigValidCode,
    created_at: '2026-09-23T00:00:00.000Z',
    is_showcase: true,
    ...overrides,
  }
}

describe('GET /api/showcase — excludes unsubstituted-placeholder entries (builder#960)', () => {
  beforeEach(() => { h.listGenerations.mockReset() })

  it('excludes the real live company-app row (chat_id x6wOHR9rN8UDxcUyTXElZ, title "{slug}`")', async () => {
    h.listGenerations.mockResolvedValue([
      row({ chat_id: 'x6wOHR9rN8UDxcUyTXElZ', prompt: LANDING_PROMPT }),
    ])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'x6wOHR9rN8UDxcUyTXElZ')).toBe(false)
    // And the garbage slug/title must not appear anywhere in the payload.
    expect(data.entries.some((e: any) => e.slug === 'slug-x6wOHR')).toBe(false)
    expect(data.entries.some((e: any) => String(e.title).includes('{slug}'))).toBe(false)
  })

  it('excludes the real live company-product row (chat_id 7W6siLoHGM8O4rsusuIQt, title "{slug}`")', async () => {
    h.listGenerations.mockResolvedValue([
      row({ chat_id: '7W6siLoHGM8O4rsusuIQt', prompt: PRODUCT_PROMPT }),
    ])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === '7W6siLoHGM8O4rsusuIQt')).toBe(false)
    expect(data.entries.some((e: any) => e.slug === 'slug-7W6siL')).toBe(false)
  })

  it('excludes them even though both pass is_showcase AND isQualityApp (the pre-existing gates could never catch these)', async () => {
    h.listGenerations.mockResolvedValue([
      row({ chat_id: 'x6wOHR9rN8UDxcUyTXElZ', prompt: LANDING_PROMPT, is_showcase: true }),
      row({ chat_id: '7W6siLoHGM8O4rsusuIQt', prompt: PRODUCT_PROMPT, is_showcase: true }),
    ])
    const res = await GET(req())
    const data = await res.json()
    const placeholderEntries = data.entries.filter((e: any) => String(e.title).includes('{') || String(e.title).includes('`'))
    expect(placeholderEntries).toEqual([])
  })

  it('excludes a stored title that is a placeholder, not only a derived one', async () => {
    h.listGenerations.mockResolvedValue([row({ chat_id: 'stored-title', title: '${companyName}' })])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'stored-title')).toBe(false)
  })

  it('still includes a real generation alongside the bad ones (the filter is not over-broad)', async () => {
    h.listGenerations.mockResolvedValue([
      row({ chat_id: 'x6wOHR9rN8UDxcUyTXElZ', prompt: LANDING_PROMPT }),
      row({ chat_id: 'real-one' }), // the default habit-tracker prompt
    ])
    const res = await GET(req())
    const data = await res.json()
    expect(data.entries.some((e: any) => e.chatId === 'real-one')).toBe(true)
    expect(data.entries.some((e: any) => e.chatId === 'x6wOHR9rN8UDxcUyTXElZ')).toBe(false)
  })

  it('does not exclude a real company-app generation for a legitimately-named company', async () => {
    const goodLanding = LANDING_PROMPT.replace(/\{slug\}`/g, 'Meridian')
    h.listGenerations.mockResolvedValue([row({ chat_id: 'meridian', prompt: goodLanding })])
    const res = await GET(req())
    const data = await res.json()
    const entry = data.entries.find((e: any) => e.chatId === 'meridian')
    expect(entry).toBeDefined()
    expect(entry.title).toBe('Meridian')
  })
})
