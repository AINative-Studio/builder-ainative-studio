import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Real bug found live (younova and others, 2026-11-13): saveGeneration()
 * always APPENDS a new row per turn for a given chat_id (confirmed: it only
 * ever POSTs to .../rows, never updates one in place). loadGeneration() used
 * to fetch only `limit: 1` with no sort, trusting the ZeroDB query endpoint
 * to hand back the newest row for a multi-turn chat — but loadChatHistory,
 * which hits this exact same table with the exact same chat_id filter, has
 * to sort its own results by created_at client-side, which is proof the
 * endpoint provides no ordering guarantee. For any chat with more than one
 * saved turn, `limit: 1` could silently restore an early/incomplete row
 * instead of the real, later generation — serving a permanently stale or
 * empty preview even though good code exists in the table.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { loadGeneration } from '@/lib/zerodb-store'

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('loadGeneration picks the newest row for a multi-turn chat (younova-class bug)', () => {
  it('returns the latest generated_code, not whichever row the query endpoint lists first', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          // Intentionally NOT in chronological order — the real bug is that
          // the endpoint gives no ordering guarantee, so a fix that assumes
          // "first row returned" is correct would still fail this test.
          {
            row_data: {
              chat_id: 'chat-multi-turn',
              created_at: '2026-11-10T00:00:00.000Z',
              prompt: 'build a landing page',
              generated_code: 'export default function App(){ return null }',
              code_length: 10,
            },
          },
          {
            row_data: {
              chat_id: 'chat-multi-turn',
              created_at: '2026-11-12T00:00:00.000Z',
              prompt: 'add a pricing section',
              generated_code: 'export default function App(){ return <div>Real pricing page</div> }',
              code_length: 70,
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-multi-turn')
    expect(gen?.generatedCode).toBe('export default function App(){ return <div>Real pricing page</div> }')
  })

  it('still returns the only row for a single-turn chat (no regression)', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-single-turn',
              created_at: '2026-11-12T00:00:00.000Z',
              prompt: 'build a landing page',
              generated_code: 'export default function App(){ return null }',
              code_length: 10,
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-single-turn')
    expect(gen?.generatedCode).toBe('export default function App(){ return null }')
  })

  it('returns null when no rows match, same as before', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: [] }))
    const gen = await loadGeneration('chat-no-rows')
    expect(gen).toBeNull()
  })

  // Real gap found live (2026-11-14, a day after the fix above deployed):
  // #2000's own repro chat_ids (younova, me-vC5htD, candor, graintrack) were
  // STILL 404ing on GET /api/generation/{id}/files after #2001 shipped.
  // saveGeneration() has no "skip on failure" guard, so a later turn can
  // append an empty row for the same chat_id (an aborted edit, a retry after
  // an API error) — the newest-by-created_at row is then empty, and the
  // prior fix's "always take the newest" picks it over the real, older
  // generation, reproducing the exact permanent-blank-preview symptom this
  // whole fix was meant to close.
  it('skips a newer but empty row and falls back to an older row with real content', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-later-turn-failed',
              created_at: '2026-11-10T00:00:00.000Z',
              prompt: 'build a landing page',
              generated_code: 'export default function App(){ return <div>Real app</div> }',
              code_length: 60,
            },
          },
          {
            row_data: {
              chat_id: 'chat-later-turn-failed',
              created_at: '2026-11-13T00:00:00.000Z',
              prompt: 'add a pricing section',
              generated_code: '',
              code_length: 0,
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-later-turn-failed')
    expect(gen?.generatedCode).toBe('export default function App(){ return <div>Real app</div> }')
  })

  it('still returns the newest row when every row for the chat is empty (no regression)', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-all-empty',
              created_at: '2026-11-10T00:00:00.000Z',
              generated_code: '',
              code_length: 0,
            },
          },
          {
            row_data: {
              chat_id: 'chat-all-empty',
              created_at: '2026-11-13T00:00:00.000Z',
              generated_code: '   ',
              code_length: 3,
            },
          },
        ],
      }),
    )
    const gen = await loadGeneration('chat-all-empty')
    expect(gen?.generatedCode).toBe('   ')
  })

  // #2138 — this query has no server-side order-by (see this file's own doc
  // comment above), so a chat_id with more rows than `limit` can have its
  // real quality row silently excluded from the fetched set entirely —
  // confirmed live for issue761-verify (hasCode:true on /showcase, but
  // permanently "Preview Unavailable"). loadChatHistory() reads this exact
  // same table/filter and already uses limit:100 — this just removes the
  // unexplained 50-vs-100 asymmetry between the two sibling functions.
  it('queries with the same row limit (100) loadChatHistory already uses for this table', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: [] }))
    await loadGeneration('chat-limit-check')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const sentBody = JSON.parse(init.body)
    expect(sentBody.limit).toBe(100)
    expect(sentBody.filters).toEqual({ chat_id: 'chat-limit-check' })
  })
})
