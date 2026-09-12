import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Chat handoff summary (#608) — "it will be good to create occasional convo
 * summary or handoff file so I don't have to start fresh with cody every day
 * or everytime I restart" (real Enterprise customer feedback). Tests the
 * pure regeneration policy + prompt builder directly, and the I/O layer with
 * mocked fetch (matching this codebase's established pattern for these
 * lib/build/*-store.ts modules).
 */

import {
  shouldRegenerateSummary,
  buildSummaryPrompt,
  MIN_NEW_TURNS_TO_REGENERATE,
  type ChatSummary,
} from '@/lib/build/chat-summary'
import type { ChatTurn } from '@/lib/build/chat-store'

describe('shouldRegenerateSummary (pure, #608)', () => {
  it('never regenerates for an empty conversation', () => {
    expect(shouldRegenerateSummary(0, null)).toBe(false)
  })

  it('regenerates when no summary exists yet and there is at least one turn', () => {
    expect(shouldRegenerateSummary(1, null)).toBe(true)
    expect(shouldRegenerateSummary(3, null)).toBe(true)
  })

  it('does NOT regenerate when fewer than MIN_NEW_TURNS_TO_REGENERATE new turns have accumulated', () => {
    const existing: ChatSummary = { summary: 'x', turnsCovered: 4, updatedAt: '' }
    expect(shouldRegenerateSummary(4 + MIN_NEW_TURNS_TO_REGENERATE - 1, existing)).toBe(false)
  })

  it('regenerates once exactly MIN_NEW_TURNS_TO_REGENERATE new turns have accumulated', () => {
    const existing: ChatSummary = { summary: 'x', turnsCovered: 4, updatedAt: '' }
    expect(shouldRegenerateSummary(4 + MIN_NEW_TURNS_TO_REGENERATE, existing)).toBe(true)
  })
})

describe('buildSummaryPrompt (pure, #608)', () => {
  const turns: ChatTurn[] = [
    { role: 'user', text: 'change the headline to Grow Faster', createdAt: '' },
    { role: 'assistant', text: 'Done — dispatched as a real task.', createdAt: '' },
  ]

  it('includes the company name, idea, and the real transcript', () => {
    const { system, user } = buildSummaryPrompt('Ember Box', 'a hot sauce subscription box', turns)
    expect(user).toContain('Ember Box')
    expect(user).toContain('a hot sauce subscription box')
    expect(user).toContain('Founder: change the headline to Grow Faster')
    expect(user).toContain('Cody: Done — dispatched as a real task.')
    expect(system).toMatch(/where we left off/i)
  })

  it('never claims markdown formatting is used', () => {
    const { system } = buildSummaryPrompt('X', 'y', turns)
    expect(system).toMatch(/no markdown/i)
  })
})

// ---------- I/O ----------

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env = { ...originalEnv, ZERODB_API_KEY: 'k' }
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('loadChatSummary / saveChatSummary (#608)', () => {
  it('saves a summary via a real append POST', async () => {
    const fn = vi.fn(async (_url: string, init?: any) => ({ ok: true, json: async () => ({ row_id: 'r1' }) }))
    vi.stubGlobal('fetch', fn)
    const { saveChatSummary } = await import('@/lib/build/chat-summary')
    const ok = await saveChatSummary('a::b', 'Real summary text.', 6)
    expect(ok).toBe(true)
    const [url, init] = fn.mock.calls[0]
    expect(url).toContain('/database/tables/build_chat_summaries/rows')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.row_data.scope_key).toBe('a::b')
    expect(body.row_data.summary).toBe('Real summary text.')
    expect(body.row_data.turns_covered).toBe(6)
  })

  it('loads the LATEST summary by created_at when multiple rows exist (latest-wins)', async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { row_data: { scope_key: 'a::b', summary: 'old', turns_covered: 4, created_at: '2026-01-01T00:00:00.000Z' } },
          { row_data: { scope_key: 'a::b', summary: 'new', turns_covered: 10, created_at: '2026-01-02T00:00:00.000Z' } },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fn)
    const { loadChatSummary } = await import('@/lib/build/chat-summary')
    const result = await loadChatSummary('a::b')
    expect(result?.summary).toBe('new')
    expect(result?.turnsCovered).toBe(10)
  })

  it('returns null when no summary exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })))
    const { loadChatSummary } = await import('@/lib/build/chat-summary')
    expect(await loadChatSummary('a::b')).toBeNull()
  })

  it('returns null (never throws) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const { loadChatSummary } = await import('@/lib/build/chat-summary')
    expect(await loadChatSummary('a::b')).toBeNull()
  })
})

describe('ensureChatSummary (#608)', () => {
  it('generates and saves a fresh summary when none exists yet', async () => {
    const fn = vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      if (u.endsWith('/query')) return { ok: true, json: async () => ({ data: [] }) }
      if (u.endsWith('/rows') && init?.method === 'POST') return { ok: true, json: async () => ({ row_id: 'r1' }) }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fn)
    vi.doMock('@/lib/build/claude-completion', () => ({
      getClaudeCompletion: () => ({
        model: 'claude-x',
        client: { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: 'The founder asked for a headline change; Cody shipped it.' }] })) } },
      }),
    }))
    const { ensureChatSummary } = await import('@/lib/build/chat-summary')
    const turns: ChatTurn[] = [
      { role: 'user', text: 'change the headline', createdAt: '' },
      { role: 'assistant', text: 'Done.', createdAt: '' },
    ]
    const result = await ensureChatSummary('a::b', 'Ember Box', 'hot sauce', turns)
    expect(result?.summary).toBe('The founder asked for a headline change; Cody shipped it.')
  })

  it('returns the existing summary without an LLM call when regeneration is not warranted', async () => {
    const fn = vi.fn(async (url: string) => {
      if (String(url).endsWith('/query')) {
        return { ok: true, json: async () => ({ data: [{ row_data: { scope_key: 'a::b', summary: 'existing', turns_covered: 100, created_at: '2026-01-01T00:00:00.000Z' } }] }) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fn)
    const claudeSpy = vi.fn()
    vi.doMock('@/lib/build/claude-completion', () => ({ getClaudeCompletion: claudeSpy }))
    const { ensureChatSummary } = await import('@/lib/build/chat-summary')
    const turns: ChatTurn[] = [{ role: 'user', text: 'hi', createdAt: '' }]
    const result = await ensureChatSummary('a::b', 'Ember Box', 'hot sauce', turns)
    expect(result?.summary).toBe('existing')
    expect(claudeSpy).not.toHaveBeenCalled()
  })

  it('returns null (never throws) for an empty scope key', async () => {
    const { ensureChatSummary } = await import('@/lib/build/chat-summary')
    expect(await ensureChatSummary('', 'X', 'y', [])).toBeNull()
  })
})
