import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #52 — lib/build/chat-store: durable build-chat persistence + Cody memory.
 *
 * Covered:
 *   - chatKey() normalization + empty-part handling,
 *   - appendTurn() / appendExchange() write semantics + blank/degraded no-ops,
 *   - loadConversation() ordering, key-filtering, MAX_TURNS clip, error → [],
 *   - toMessages() role mapping (cody → assistant) + recent-N windowing.
 *
 * The module reads env at import time, so we set env BEFORE importing it and mock
 * global.fetch to simulate the ZeroDB rows API.
 */

const ENV = {
  AINATIVE_API_URL: 'https://api.test',
  AINATIVE_API_KEY: 'k_test',
  ZERODB_PROJECT_ID: 'proj_test',
}

beforeEach(() => {
  vi.resetModules()
  process.env.AINATIVE_API_URL = ENV.AINATIVE_API_URL
  process.env.AINATIVE_API_KEY = ENV.AINATIVE_API_KEY
  process.env.ZERODB_PROJECT_ID = ENV.ZERODB_PROJECT_ID
  delete process.env.ZERODB_API_KEY
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Import the module fresh so it picks up whatever env is currently set. */
async function load() {
  return await import('@/lib/build/chat-store')
}

describe('chatKey', () => {
  it('normalizes owner + slug (trim + lowercase)', async () => {
    const { chatKey } = await load()
    expect(chatKey('  Founder@Acme.COM ', ' Acme-Co ')).toBe('founder@acme.com:acme-co')
  })

  it('returns "" when either part is missing', async () => {
    const { chatKey } = await load()
    expect(chatKey('', 'acme')).toBe('')
    expect(chatKey('owner', '')).toBe('')
    expect(chatKey('  ', ' ')).toBe('')
  })
})

describe('appendTurn', () => {
  it('POSTs a row and returns true on ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendTurn } = await load()

    const ok = await appendTurn('founder@acme.com:acme', { role: 'user', text: 'hello' })
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/projects/proj_test/database/tables/builder_build_chat/rows')
    const body = JSON.parse(init.body)
    expect(body.row_data).toMatchObject({
      key: 'founder@acme.com:acme', owner: 'founder@acme.com', slug: 'acme', role: 'user', text: 'hello',
    })
    expect(typeof body.row_data.createdAt).toBe('string')
  })

  it('no-ops (false, no fetch) for a blank key or blank text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendTurn } = await load()

    expect(await appendTurn('', { role: 'user', text: 'x' })).toBe(false)
    expect(await appendTurn('k:s', { role: 'user', text: '   ' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('coerces an unknown role to "cody" and clips very long text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendTurn } = await load()

    await appendTurn('o:s', { role: 'weird' as any, text: 'a'.repeat(9000) })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.row_data.role).toBe('cody')
    expect(body.row_data.text.length).toBe(8000)
  })

  it('returns false on a network error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    const { appendTurn } = await load()
    expect(await appendTurn('o:s', { role: 'user', text: 'hi' })).toBe(false)
  })

  it('no-ops when unconfigured (missing project id / key)', async () => {
    delete process.env.ZERODB_PROJECT_ID
    delete process.env.AINATIVE_API_KEY
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendTurn } = await load()
    expect(await appendTurn('o:s', { role: 'user', text: 'hi' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('appendExchange', () => {
  it('writes the question THEN the answer, ordered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendExchange } = await load()

    const ok = await appendExchange('o:s', 'why?', 'because')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetchMock.mock.calls[0][1].body).row_data
    const second = JSON.parse(fetchMock.mock.calls[1][1].body).row_data
    expect(first.role).toBe('user')
    expect(second.role).toBe('cody')
    // The answer must sort strictly after the question.
    expect(second.createdAt.localeCompare(first.createdAt)).toBeGreaterThan(0)
  })

  it('records the question even when the answer is blank (still returns false)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendExchange } = await load()

    const ok = await appendExchange('o:s', 'q only', '   ')
    expect(ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).row_data.role).toBe('user')
  })

  it('no-ops for an empty key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const { appendExchange } = await load()
    expect(await appendExchange('', 'q', 'a')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('loadConversation', () => {
  function rowsResponse(rows: any[]) {
    return { ok: true, text: async () => JSON.stringify({ data: rows.map((row_data) => ({ row_data })) }) }
  }

  it('returns turns for the key, oldest-first, dropping other keys', async () => {
    const rows = [
      { key: 'o:s', role: 'cody', text: 'second', createdAt: '2026-01-01T00:00:02Z' },
      { key: 'o:s', role: 'user', text: 'first', createdAt: '2026-01-01T00:00:01Z' },
      { key: 'other:s', role: 'user', text: 'nope', createdAt: '2026-01-01T00:00:03Z' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rowsResponse(rows)))
    const { loadConversation } = await load()

    const turns = await loadConversation('o:s')
    expect(turns.map((t) => t.text)).toEqual(['first', 'second'])
    expect(turns[0].role).toBe('user')
    expect(turns[1].role).toBe('cody')
  })

  it('returns [] for an empty key or unconfigured store (no fetch)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { loadConversation } = await load()
    expect(await loadConversation('')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns [] on a non-ok response and on a thrown error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }))
    let mod = await load()
    expect(await mod.loadConversation('o:s')).toEqual([])

    vi.resetModules()
    process.env.AINATIVE_API_KEY = ENV.AINATIVE_API_KEY
    process.env.ZERODB_PROJECT_ID = ENV.ZERODB_PROJECT_ID
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    mod = await load()
    expect(await mod.loadConversation('o:s')).toEqual([])
  })

  it('clips to the last MAX_TURNS', async () => {
    const { MAX_TURNS } = await load()
    const many = Array.from({ length: MAX_TURNS + 20 }, (_, i) => ({
      key: 'o:s', role: 'user', text: `t${i}`, createdAt: new Date(1700000000000 + i * 1000).toISOString(),
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rowsResponse(many)))
    const { loadConversation } = await load()
    const turns = await loadConversation('o:s')
    expect(turns.length).toBe(MAX_TURNS)
    // Kept the LAST MAX_TURNS (t20 … tN), dropped the earliest.
    expect(turns[0].text).toBe('t20')
  })
})

describe('toMessages', () => {
  it('maps cody → assistant, user → user', async () => {
    const { toMessages } = await load()
    const msgs = toMessages([
      { role: 'user', text: 'hi' },
      { role: 'cody', text: 'hello' },
    ])
    expect(msgs).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('keeps only the last N turns and drops blanks', async () => {
    const { toMessages } = await load()
    const turns = [
      { role: 'user' as const, text: 'a' },
      { role: 'cody' as const, text: '   ' }, // blank → dropped
      { role: 'user' as const, text: 'b' },
      { role: 'cody' as const, text: 'c' },
    ]
    const msgs = toMessages(turns, 2)
    expect(msgs.map((m) => m.content)).toEqual(['b', 'c'])
  })

  it('handles an empty / undefined input', async () => {
    const { toMessages } = await load()
    expect(toMessages([])).toEqual([])
    expect(toMessages(undefined as any)).toEqual([])
  })
})
