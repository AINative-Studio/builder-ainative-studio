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
// read" behavior, not a fabricated server-side upsert.
function mockFetch(storedRows: Array<Record<string, unknown>>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    if (init?.method === 'POST' && u.includes('/rows')) {
      const body = JSON.parse(String(init.body))
      storedRows.push(body.row_data)
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
    }
    if (u.includes('/rows')) {
      return { ok: true, status: 200, json: async () => storedRows.map((row_data) => ({ row_data })), text: async () => JSON.stringify(storedRows.map((row_data) => ({ row_data }))) } as unknown as Response
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
    const rows: Array<Record<string, unknown>> = []
    mockFetch(rows)
    const { saveAnonDraft, loadAnonDraft } = await import('@/lib/build/anon-drafts')
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: {}, step: 'kickoff-1' })
    await new Promise((r) => setTimeout(r, 2))
    await saveAnonDraft('tok-2', { idea: 'x', track: 'company', answers: { who: 'a' }, step: 'kickoff-2' })
    const draft = await loadAnonDraft('tok-2')
    expect(draft?.step).toBe('kickoff-2')
  })
})
