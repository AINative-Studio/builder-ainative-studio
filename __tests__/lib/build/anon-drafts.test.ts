import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

// A real ZeroDB `POST .../rows` call is a pure INSERT, never an upsert --
// confirmed by every other module in this codebase (otp.ts's own
// append-only/latest-wins pattern exists for exactly this reason: there is
// no real update-by-key). This mock reflects that honestly (always
// appends) so the test below exercises the real "latest write wins on
// read" behavior, not a fabricated server-side upsert. Rows also carry a
// real row_id (matching the purge cron's own real response shape), since
// deleteAnonDraft needs it to issue a real per-row DELETE.
function mockFetch(storedRows: Array<{ row_id: string; row_data: Record<string, unknown> }>) {
  let nextId = storedRows.length
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      storedRows.push({ row_id: `row-${nextId++}`, row_data: body.row_data })
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (init?.method === 'DELETE') {
      const rowId = u.split('/').pop()
      const before = storedRows.length
      const kept = storedRows.filter((r) => r.row_id !== rowId)
      storedRows.length = 0
      storedRows.push(...kept)
      return { ok: storedRows.length < before, status: storedRows.length < before ? 200 : 404, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return { ok: true, status: 200, json: async () => storedRows, text: async () => JSON.stringify(storedRows) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('anon-drafts (#E3.4)', () => {
  it('saves and loads a draft by token', async () => {
    mockFetch([])
    const { saveAnonDraft, loadAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-1', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-2' })
    const draft = await loadAnonDraft('tok-1')
    expect(draft?.step).toBe('kickoff-2')
  })

  it('returns null for an unknown token, never throws', async () => {
    mockFetch([])
    const { loadAnonDraft } = await import('@/lib/build/anon-drafts')
    expect(await loadAnonDraft('unknown-token')).toBeNull()
  })

  it('a second save for the SAME token: the real latest-write wins on read (append-only storage, same pattern as otp.ts)', async () => {
    const rows: Array<{ row_id: string; row_data: Record<string, unknown> }> = []
    mockFetch(rows)
    const { saveAnonDraft, loadAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
    await new Promise((r) => setTimeout(r, 2))
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: { who: 'a' }, step: 'kickoff-2' })
    const draft = await loadAnonDraft('tok-2')
    expect(draft?.step).toBe('kickoff-2')
  })
})

describe('deleteAnonDraft (#1476)', () => {
  it('deletes the real stored row for a token, so a later load returns null', async () => {
    const rows: Array<{ row_id: string; row_data: Record<string, unknown> }> = []
    mockFetch(rows)
    const { saveAnonDraft, loadAnonDraft, deleteAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-del-1', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })

    const result = await deleteAnonDraft('tok-del-1')
    expect(result).toEqual({ ok: true, deleted: 1 })
    expect(await loadAnonDraft('tok-del-1')).toBeNull()
  })

  it('deletes every real row for a token when it was saved more than once (append-only storage)', async () => {
    const rows: Array<{ row_id: string; row_data: Record<string, unknown> }> = []
    mockFetch(rows)
    const { saveAnonDraft, deleteAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-del-2', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
    await saveAnonDraft('tok-del-2', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-2' })

    const result = await deleteAnonDraft('tok-del-2')
    expect(result).toEqual({ ok: true, deleted: 2 })
    expect(rows.filter((r) => r.row_data.token === 'tok-del-2')).toHaveLength(0)
  })

  it('never deletes a DIFFERENT token\'s rows', async () => {
    const rows: Array<{ row_id: string; row_data: Record<string, unknown> }> = []
    mockFetch(rows)
    const { saveAnonDraft, loadAnonDraft, deleteAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-keep', { idea: 'keep-me', track: 'company', answers: {}, step: 'kickoff-1' })
    await saveAnonDraft('tok-del-3', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })

    await deleteAnonDraft('tok-del-3')

    expect(await loadAnonDraft('tok-keep')).not.toBeNull()
  })

  it('returns deleted:0 for an unknown token, never throws', async () => {
    mockFetch([])
    const { deleteAnonDraft } = await import('@/lib/build/anon-drafts')
    const result = await deleteAnonDraft('unknown-token')
    expect(result).toEqual({ ok: true, deleted: 0 })
  })

  it('never throws when the real DELETE request itself fails', async () => {
    const rows: Array<{ row_id: string; row_data: Record<string, unknown> }> = []
    mockFetch(rows)
    const { saveAnonDraft, deleteAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-del-4', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('network down')
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) } as unknown as Response
    }))

    await expect(deleteAnonDraft('tok-del-4')).resolves.toEqual({ ok: false, deleted: 0 })
  })
})
