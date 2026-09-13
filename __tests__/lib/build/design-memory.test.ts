import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Design memory — real ZeroDB persistence for a build thread's design
 * preferences and component history, replacing lib/services/memory.service.ts
 * (removed 2026-09-13). See design-memory.ts's own doc comment for the full
 * history: that file both violated the ZeroMemory/database architecture
 * boundary (real project artifacts persisted via /remember, which is scoped
 * to agent/conversation memory) AND was keyed on an id (`responseId` —
 * `chatId || nanoid()`) that could never actually round-trip on a thread's
 * first call. This replacement uses a real ZeroDB table, keyed on the
 * genuinely stable `chatId`.
 */

import {
  extractComponentType,
  loadDesignMemory,
  recordComponent,
  formatDesignMemoryForPrompt,
} from '@/lib/build/design-memory'

function mockFetchSequence(responses: Array<{ ok: boolean; json?: any }>) {
  let i = 0
  const fn = vi.fn(async (_url?: string, _init?: RequestInit) => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return { ok: r.ok, json: async () => (r.json ?? {}) } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('extractComponentType (pure)', () => {
  it('extracts a named function component', () => {
    expect(extractComponentType('function Dashboard() { return <div/> }')).toBe('Dashboard')
  })

  it('extracts a const-assigned component', () => {
    expect(extractComponentType('const PriceCard = () => <div/>')).toBe('PriceCard')
  })

  it('falls back to Unknown when no pattern matches', () => {
    expect(extractComponentType('<div>raw jsx with no wrapper</div>')).toBe('Unknown')
  })
})

describe('loadDesignMemory', () => {
  it('returns null for an empty chatId, without calling fetch', async () => {
    const fn = mockFetchSequence([{ ok: true, json: { data: [] } }])
    expect(await loadDesignMemory('')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns null when no row exists yet for this chatId', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    expect(await loadDesignMemory('chat-123')).toBeNull()
  })

  it('returns the latest row when one exists, parsed correctly', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [{
          row_data: {
            chat_id: 'chat-123',
            design_preferences: { colorScheme: ['blue'], typography: 'sans-serif' },
            component_history: [{ prompt: 'add a hero section', componentType: 'Hero', createdAt: '2026-09-13T00:00:00Z' }],
            feedback: [],
            updated_at: '2026-09-13T00:00:01Z',
          },
        }],
      },
    }])
    const result = await loadDesignMemory('chat-123')
    expect(result?.designPreferences?.colorScheme).toEqual(['blue'])
    expect(result?.componentHistory).toHaveLength(1)
    expect(result?.componentHistory[0].componentType).toBe('Hero')
  })

  it('picks the LATEST row by updated_at when multiple exist', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [
          { row_data: { chat_id: 'chat-123', component_history: [], feedback: [], updated_at: '2026-09-13T00:00:00Z', design_preferences: { typography: 'old' } } },
          { row_data: { chat_id: 'chat-123', component_history: [], feedback: [], updated_at: '2026-09-13T00:05:00Z', design_preferences: { typography: 'new' } } },
        ],
      },
    }])
    const result = await loadDesignMemory('chat-123')
    expect(result?.designPreferences?.typography).toBe('new')
  })

  it('returns null (never throws) on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    expect(await loadDesignMemory('chat-123')).toBeNull()
  })
})

describe('recordComponent', () => {
  it('is a no-op when chatId, prompt, or componentCode is empty', async () => {
    const fn = mockFetchSequence([{ ok: true, json: { data: [] } }])
    await recordComponent('', 'a prompt', 'const X = () => null')
    await recordComponent('chat-123', '', 'const X = () => null')
    await recordComponent('chat-123', 'a prompt', '')
    expect(fn).not.toHaveBeenCalled()
  })

  it('loads existing history, appends the new component, and persists it', async () => {
    const fn = mockFetchSequence([
      { ok: true, json: { data: [] } }, // loadDesignMemory: nothing yet
      { ok: true, json: { ok: true } }, // saveDesignMemory: the real POST
    ])
    await recordComponent('chat-123', 'add a pricing table', 'function PricingTable() { return null }')

    expect(fn).toHaveBeenCalledTimes(2)
    const [, saveInit] = fn.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(String(saveInit.body))
    expect(body.row_data.chat_id).toBe('chat-123')
    expect(body.row_data.component_history).toHaveLength(1)
    expect(body.row_data.component_history[0].componentType).toBe('PricingTable')
  })

  it('never throws when the underlying calls fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await expect(recordComponent('chat-123', 'x', 'const X = () => null')).resolves.toBeUndefined()
  })
})

describe('formatDesignMemoryForPrompt', () => {
  it('returns an empty string for an empty chatId, without calling fetch', async () => {
    const fn = mockFetchSequence([{ ok: true, json: { data: [] } }])
    expect(await formatDesignMemoryForPrompt('')).toBe('')
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns an empty string when nothing exists yet — never a placeholder empty-shell section', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    expect(await formatDesignMemoryForPrompt('chat-123')).toBe('')
  })

  it('includes real design preferences when they exist', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [{
          row_data: {
            chat_id: 'chat-123',
            design_preferences: { colorScheme: ['blue', 'white'], typography: 'Inter', spacing: 'compact' },
            component_history: [],
            feedback: [],
            updated_at: '2026-09-13T00:00:00Z',
          },
        }],
      },
    }])
    const result = await formatDesignMemoryForPrompt('chat-123')
    expect(result).toContain('blue, white')
    expect(result).toContain('Inter')
    expect(result).toContain('compact')
  })

  it('includes recent component history, capped at the most recent 3', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [{
          row_data: {
            chat_id: 'chat-123',
            component_history: [
              { prompt: 'add A', componentType: 'A', createdAt: '' },
              { prompt: 'add B', componentType: 'B', createdAt: '' },
              { prompt: 'add C', componentType: 'C', createdAt: '' },
              { prompt: 'add D', componentType: 'D', createdAt: '' },
            ],
            feedback: [],
            updated_at: '2026-09-13T00:00:00Z',
          },
        }],
      },
    }])
    const result = await formatDesignMemoryForPrompt('chat-123')
    expect(result).not.toContain('add A') // oldest, beyond the cap of 3
    expect(result).toContain('add B')
    expect(result).toContain('add C')
    expect(result).toContain('add D')
  })

  it('never throws — returns an empty string on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await formatDesignMemoryForPrompt('chat-123')).toBe('')
  })
})
