import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deriveOwnerKey,
  chatScopeKey,
  buildMessagesWithHistory,
  appendChatTurn,
  saveExchange,
  loadChat,
  loadChatWithFallback,
  DEFAULT_HISTORY_TURNS,
  MAX_LOAD_TURNS,
  type ChatTurn,
} from '@/lib/build/chat-store'

/**
 * #52 — Cody chat persistence. Covers the pure core (owner-key derivation, scope
 * key, history → messages windowing) and the ZeroDB-backed I/O (append/save/load)
 * by mocking global.fetch. The vitest env is 'node'; fetch is stubbed per-test so
 * no network is touched.
 */

// ---------- deriveOwnerKey ----------
describe('deriveOwnerKey (#52)', () => {
  it('keys an authenticated user by lowercased email', () => {
    expect(deriveOwnerKey({ user: { email: 'Founder@Acme.com', type: 'regular' } })).toBe('founder@acme.com')
  })

  it('keys a guest (by type) by their stable session id, not email', () => {
    expect(deriveOwnerKey({ user: { email: 'guest-abc@example.com', type: 'guest', id: 'u-123' } })).toBe('guest:u-123')
  })

  it('detects a guest by the guest-<uuid>@example.com email shape even without type', () => {
    expect(deriveOwnerKey({ user: { email: 'guest-xyz@example.com', id: 'sess-9' } })).toBe('guest:sess-9')
  })

  it('falls back to the guest email when no id is present', () => {
    expect(deriveOwnerKey({ user: { email: 'guest-xyz@example.com', type: 'guest' } })).toBe('guest:guest-xyz@example.com')
  })

  it('returns guest:anon for a null/empty session', () => {
    expect(deriveOwnerKey(null)).toBe('guest:anon')
    expect(deriveOwnerKey(undefined)).toBe('guest:anon')
    expect(deriveOwnerKey({ user: null })).toBe('guest:anon')
    expect(deriveOwnerKey({ user: {} })).toBe('guest:anon')
  })

  it('trims surrounding whitespace on the email', () => {
    expect(deriveOwnerKey({ user: { email: '  a@b.com  ' } })).toBe('a@b.com')
  })
})

// ---------- chatScopeKey ----------
describe('chatScopeKey (#52)', () => {
  it('composes owner + lowercased slug', () => {
    expect(chatScopeKey('a@b.com', 'Acme-Co')).toBe('a@b.com::acme-co')
  })

  it('normalizes a blank slug to "untitled" so companies never collide on empty', () => {
    expect(chatScopeKey('a@b.com', '')).toBe('a@b.com::untitled')
    expect(chatScopeKey('a@b.com', '   ')).toBe('a@b.com::untitled')
  })

  it('is stable for the same owner + company', () => {
    expect(chatScopeKey('g:1', 'x')).toBe(chatScopeKey('g:1', 'X'))
  })
})

// ---------- buildMessagesWithHistory ----------
const turn = (role: 'user' | 'assistant', text: string, createdAt = '2026-01-01T00:00:00Z'): ChatTurn => ({ role, text, createdAt })

describe('buildMessagesWithHistory (#52)', () => {
  it('appends the current question as the final user turn', () => {
    const msgs = buildMessagesWithHistory([], 'hello')
    expect(msgs).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('includes prior history before the new question', () => {
    const history = [turn('user', 'q1'), turn('assistant', 'a1')]
    const msgs = buildMessagesWithHistory(history, 'q2')
    expect(msgs).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('keeps only the most recent maxTurns turns', () => {
    const history: ChatTurn[] = []
    for (let i = 0; i < 10; i++) history.push(turn('user', `u${i}`), turn('assistant', `a${i}`))
    const msgs = buildMessagesWithHistory(history, 'now', 4)
    // last 4 history turns + the new question
    expect(msgs.map((m) => m.content)).toEqual(['u8', 'a8', 'u9', 'a9', 'now'])
  })

  it('drops a leading assistant turn (Anthropic requires first message = user)', () => {
    const history = [turn('assistant', 'orphan'), turn('user', 'q1'), turn('assistant', 'a1')]
    const msgs = buildMessagesWithHistory(history, 'q2', 3)
    // window is last 3: [assistant orphan? no — last3 = user q1, assistant a1] -> plus leading trim
    expect(msgs[0].role).toBe('user')
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'q2' })
  })

  it('trims all leading assistant turns when the window starts with them', () => {
    const history = [turn('assistant', 'x1'), turn('assistant', 'x2'), turn('user', 'q1')]
    const msgs = buildMessagesWithHistory(history, 'q2', 10)
    expect(msgs).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('ignores empty/whitespace and malformed turns', () => {
    const history: any[] = [
      turn('user', '   '),
      { role: 'nope', text: 'bad' },
      null,
      turn('user', 'real'),
    ]
    const msgs = buildMessagesWithHistory(history, 'q')
    expect(msgs).toEqual([
      { role: 'user', content: 'real' },
      { role: 'user', content: 'q' },
    ])
  })

  it('returns only history (no question) when the question is blank', () => {
    const msgs = buildMessagesWithHistory([turn('user', 'q1')], '   ')
    expect(msgs).toEqual([{ role: 'user', content: 'q1' }])
  })

  it('handles a non-array history defensively', () => {
    expect(buildMessagesWithHistory(undefined as any, 'q')).toEqual([{ role: 'user', content: 'q' }])
  })

  it('defaults the window to DEFAULT_HISTORY_TURNS', () => {
    const history: ChatTurn[] = []
    for (let i = 0; i < DEFAULT_HISTORY_TURNS + 5; i++) history.push(turn('user', `u${i}`))
    const msgs = buildMessagesWithHistory(history, 'q')
    // DEFAULT_HISTORY_TURNS history + 1 question
    expect(msgs.length).toBe(DEFAULT_HISTORY_TURNS + 1)
  })

  it('trims whitespace from the question and history content', () => {
    const msgs = buildMessagesWithHistory([turn('user', '  hi  ')], '  yo  ')
    expect(msgs).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'yo' },
    ])
  })
})

// ---------- I/O: appendChatTurn / saveExchange / loadChat ----------
function mockFetch(impl: (url: string, init?: any) => { ok: boolean; status?: number; json?: () => any }) {
  const fn = vi.fn(async (url: string, init?: any) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.json ? r.json() : {}),
      text: async () => '',
    } as any
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('appendChatTurn (#52)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('POSTs a row and returns true on success', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    const ok = await appendChatTurn('a::b', { role: 'user', text: 'hi' })
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    const [url, init] = fn.mock.calls[0]
    expect(url).toContain('/database/tables/build_chat/rows')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.row_data).toMatchObject({ scope_key: 'a::b', role: 'user', text: 'hi' })
    expect(typeof body.row_data.created_at).toBe('string')
  })

  it('rejects blank text, blank scope, and invalid role without calling fetch', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await appendChatTurn('', { role: 'user', text: 'x' })).toBe(false)
    expect(await appendChatTurn('a::b', { role: 'user', text: '   ' })).toBe(false)
    expect(await appendChatTurn('a::b', { role: 'system' as any, text: 'x' })).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false (never throws) when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    expect(await appendChatTurn('a::b', { role: 'assistant', text: 'hi' })).toBe(false)
  })

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await appendChatTurn('a::b', { role: 'user', text: 'hi' })).toBe(false)
  })
})

describe('saveExchange (#52)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('writes a user turn then an assistant turn and returns true when both succeed', async () => {
    const seen: any[] = []
    const fn = mockFetch((_url, init) => { seen.push(JSON.parse(init.body).row_data); return { ok: true } })
    const ok = await saveExchange('a::b', 'question', 'answer')
    expect(ok).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(seen[0]).toMatchObject({ role: 'user', text: 'question' })
    expect(seen[1]).toMatchObject({ role: 'assistant', text: 'answer' })
  })

  it('returns false if either turn fails to persist', async () => {
    let n = 0
    mockFetch(() => { n += 1; return { ok: n === 1 } }) // first ok, second fails
    expect(await saveExchange('a::b', 'q', 'a')).toBe(false)
  })
})

describe('loadChat (#52)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k' })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns [] for a blank scope key without calling fetch', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await loadChat('')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('queries by scope_key and returns turns oldest-first', async () => {
    const fn = mockFetch(() => ({
      ok: true,
      json: () => ({
        data: [
          { row_data: { scope_key: 'a::b', role: 'assistant', text: 'a1', created_at: '2026-01-01T00:00:02Z' } },
          { row_data: { scope_key: 'a::b', role: 'user', text: 'q1', created_at: '2026-01-01T00:00:01Z' } },
        ],
      }),
    }))
    const turns = await loadChat('a::b')
    expect(turns.map((t) => t.text)).toEqual(['q1', 'a1'])
    const [url, init] = fn.mock.calls[0]
    expect(url).toContain('/database/tables/build_chat/query')
    expect(JSON.parse(init.body).filters).toEqual({ scope_key: 'a::b' })
  })

  it('accepts rows without a row_data wrapper (flat shape)', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [{ role: 'user', text: 'flat', created_at: '2026-01-01' }] }) }))
    const turns = await loadChat('a::b')
    expect(turns).toEqual([{ role: 'user', text: 'flat', createdAt: '2026-01-01' }])
  })

  it('filters out malformed rows (bad role / no text)', async () => {
    mockFetch(() => ({
      ok: true,
      json: () => ({
        data: [
          { row_data: { role: 'system', text: 'x', created_at: '1' } },
          { row_data: { role: 'user', text: '', created_at: '2' } },
          { row_data: { role: 'user', text: 'keep', created_at: '3' } },
        ],
      }),
    }))
    const turns = await loadChat('a::b')
    expect(turns).toEqual([{ role: 'user', text: 'keep', createdAt: '3' }])
  })

  it('caps the returned turns at the requested limit (most recent kept)', async () => {
    const data = Array.from({ length: 5 }, (_, i) => ({
      row_data: { role: 'user', text: `t${i}`, created_at: `2026-01-01T00:00:0${i}Z` },
    }))
    mockFetch(() => ({ ok: true, json: () => ({ data }) }))
    const turns = await loadChat('a::b', 2)
    expect(turns.map((t) => t.text)).toEqual(['t3', 't4'])
  })

  it('clamps an oversized limit to MAX_LOAD_TURNS in the query', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    await loadChat('a::b', MAX_LOAD_TURNS + 999)
    expect(JSON.parse(fn.mock.calls[0][1].body).limit).toBe(MAX_LOAD_TURNS)
  })

  it('returns [] on empty data', async () => {
    mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    expect(await loadChat('a::b')).toEqual([])
  })

  it('returns [] (never throws) when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await loadChat('a::b')).toEqual([])
  })

  it('retries once on a transient 500 and succeeds on the second attempt', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      n += 1
      if (n === 1) return { ok: false, status: 500, json: async () => ({}), text: async () => '' } as any
      return { ok: true, status: 200, json: async () => ({ data: [{ row_data: { role: 'user', text: 'ok', created_at: '1' } }] }), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)
    const turns = await loadChat('a::b')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(turns).toEqual([{ role: 'user', text: 'ok', createdAt: '1' }])
  })

  it('gives up (returns []) after retries are exhausted on persistent 500s', async () => {
    const fn = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' } as any))
    vi.stubGlobal('fetch', fn)
    const turns = await loadChat('a::b')
    // loadChat passes retries:1 → 2 attempts total
    expect(fn).toHaveBeenCalledTimes(2)
    expect(turns).toEqual([])
  })

  it('does not retry a non-transient 4xx (returns [] after one attempt)', async () => {
    const fn = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '' } as any))
    vi.stubGlobal('fetch', fn)
    const turns = await loadChat('a::b')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(turns).toEqual([])
  })
})

// ---------- #400: per-company ZeroDB project ----------
const SHARED_PROJECT_ID_FALLBACK = '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

describe('appendChatTurn / saveExchange — per-company projectId (#400)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k'; delete process.env.ZERODB_PROJECT_ID })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('writes to the SHARED project when no projectId is given (unchanged pre-#400 behavior)', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    await appendChatTurn('a::b', { role: 'user', text: 'hi' })
    const [url] = fn.mock.calls[0]
    expect(url).toContain(`/projects/${SHARED_PROJECT_ID_FALLBACK}/database/tables/build_chat/rows`)
  })

  it('writes to the COMPANY project when a projectId is given', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    await appendChatTurn('a::b', { role: 'user', text: 'hi' }, 'company-proj-123')
    const [url] = fn.mock.calls[0]
    expect(url).toContain('/projects/company-proj-123/database/tables/build_chat/rows')
  })

  it('treats a blank/whitespace projectId as "no project" — falls back to shared', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ id: 'r1' }) }))
    await appendChatTurn('a::b', { role: 'user', text: 'hi' }, '   ')
    const [url] = fn.mock.calls[0]
    expect(url).toContain(`/projects/${SHARED_PROJECT_ID_FALLBACK}/`)
  })

  it('saveExchange writes BOTH turns to the same company project', async () => {
    const urls: string[] = []
    const fn = mockFetch((url) => { urls.push(url); return { ok: true } })
    await saveExchange('a::b', 'q', 'a', 'company-proj-123')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(urls.every((u) => u.includes('/projects/company-proj-123/'))).toBe(true)
  })
})

describe('loadChatWithFallback (#400)', () => {
  beforeEach(() => { process.env.ZERODB_API_KEY = 'k'; delete process.env.ZERODB_PROJECT_ID })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('is equivalent to loadChat (single shared-project call) when no projectId is given', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    await loadChatWithFallback('a::b')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toContain(`/projects/${SHARED_PROJECT_ID_FALLBACK}/`)
  })

  it('merges OLD shared-project history with NEW company-project turns, oldest-first', async () => {
    const fn = vi.fn(async (url: string, init: any) => {
      const isCompanyProject = url.includes('/projects/company-proj-123/')
      const data = isCompanyProject
        ? [{ row_data: { role: 'user', text: 'new-turn', created_at: '2026-02-01T00:00:00Z' } }]
        : [{ row_data: { role: 'user', text: 'old-turn', created_at: '2026-01-01T00:00:00Z' } }]
      return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)

    const turns = await loadChatWithFallback('a::b', undefined, 'company-proj-123')
    expect(turns.map((t) => t.text)).toEqual(['old-turn', 'new-turn'])
    // Confirms BOTH projects were actually queried — a provisioned company
    // never silently loses its pre-migration shared-project history.
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('never loses history when the company-project read fails — shared history still returned', async () => {
    const fn = vi.fn(async (url: string) => {
      if (url.includes('/projects/company-proj-123/')) throw new Error('company project unreachable')
      return {
        ok: true, status: 200,
        json: async () => ({ data: [{ row_data: { role: 'user', text: 'old-turn', created_at: '1' } }] }),
        text: async () => '',
      } as any
    })
    vi.stubGlobal('fetch', fn)

    const turns = await loadChatWithFallback('a::b', undefined, 'company-proj-123')
    expect(turns.map((t) => t.text)).toEqual(['old-turn'])
  })

  it('falls back to a single shared-project read when projectId happens to equal the shared project id (avoids double-counting)', async () => {
    const fn = mockFetch(() => ({ ok: true, json: () => ({ data: [] }) }))
    await loadChatWithFallback('a::b', undefined, SHARED_PROJECT_ID_FALLBACK)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respects the limit cap across the merged result', async () => {
    const fn = vi.fn(async (url: string) => {
      const isCompanyProject = url.includes('/projects/company-proj-123/')
      const data = isCompanyProject
        ? [
            { row_data: { role: 'user', text: 'new1', created_at: '2026-02-01T00:00:01Z' } },
            { row_data: { role: 'user', text: 'new2', created_at: '2026-02-01T00:00:02Z' } },
          ]
        : [
            { row_data: { role: 'user', text: 'old1', created_at: '2026-01-01T00:00:01Z' } },
            { row_data: { role: 'user', text: 'old2', created_at: '2026-01-01T00:00:02Z' } },
          ]
      return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' } as any
    })
    vi.stubGlobal('fetch', fn)

    const turns = await loadChatWithFallback('a::b', 2, 'company-proj-123')
    expect(turns.map((t) => t.text)).toEqual(['new1', 'new2'])
  })

  it('returns [] for a blank scope key without calling fetch', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await loadChatWithFallback('', undefined, 'company-proj-123')).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})
