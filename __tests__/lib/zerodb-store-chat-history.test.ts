import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Chat persistence fix (2026-09-13): saveGeneration already appends one
 * durable ZeroDB row per turn (prompt + generated_code) for a given chat_id
 * — genuinely durable — but nothing ever read back MORE than the single
 * latest row (loadGeneration uses limit: 1). The in-memory
 * lib/preview-store.ts Map was the ONLY place a chat's full message history
 * lived, so it vanished on every redeploy/restart, or whenever a request
 * landed on a different Railway replica than the one that ran the
 * generation (a real, confirmed multi-instance deployment) — even though
 * every turn's data already existed durably in ZeroDB. loadChatHistory
 * reconstructs the same message-list shape from those existing rows.
 */

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { loadChatHistory } from '@/lib/zerodb-store'

function okResponse(payload: unknown = {}) {
  return { ok: true, json: async () => payload, text: async () => '' }
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('loadChatHistory', () => {
  it('returns null for an empty chatId, without calling fetch', async () => {
    expect(await loadChatHistory('')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when no rows exist for this chat', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ data: [] }))
    expect(await loadChatHistory('chat-none')).toBeNull()
  })

  it('reconstructs user+assistant turns from multiple rows, oldest first', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-multi',
              prompt: 'build a landing page',
              generated_code: 'export default function App(){ return <div>v1</div> }',
              created_at: '2026-09-13T00:00:00Z',
            },
          },
          {
            row_data: {
              chat_id: 'chat-multi',
              prompt: 'make the button blue',
              generated_code: 'export default function App(){ return <div>v2</div> }',
              created_at: '2026-09-13T00:05:00Z',
              design_system_id: 'cloud',
            },
          },
        ],
      }),
    )
    const history = await loadChatHistory('chat-multi')
    expect(history).not.toBeNull()
    expect(history!.messages).toHaveLength(4)
    expect(history!.messages[0]).toMatchObject({ role: 'user', content: 'build a landing page' })
    expect(history!.messages[1]).toMatchObject({ role: 'assistant', content: 'export default function App(){ return <div>v1</div> }' })
    expect(history!.messages[2]).toMatchObject({ role: 'user', content: 'make the button blue' })
    expect(history!.messages[3]).toMatchObject({ role: 'assistant', content: 'export default function App(){ return <div>v2</div> }' })
  })

  it('sorts rows by created_at even when the API returns them out of order', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-unsorted',
              prompt: 'second thing',
              generated_code: 'v2',
              created_at: '2026-09-13T00:05:00Z',
            },
          },
          {
            row_data: {
              chat_id: 'chat-unsorted',
              prompt: 'first thing',
              generated_code: 'v1',
              created_at: '2026-09-13T00:00:00Z',
            },
          },
        ],
      }),
    )
    const history = await loadChatHistory('chat-unsorted')
    expect(history!.messages[0].content).toBe('first thing')
    expect(history!.messages[2].content).toBe('second thing')
  })

  it('takes createdAt from the earliest row and designSystemId from the latest', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          {
            row_data: {
              chat_id: 'chat-meta',
              prompt: 'first',
              generated_code: 'v1',
              created_at: '2026-09-13T00:00:00Z',
              design_system_id: 'old-system',
            },
          },
          {
            row_data: {
              chat_id: 'chat-meta',
              prompt: 'second',
              generated_code: 'v2',
              created_at: '2026-09-13T00:05:00Z',
              design_system_id: 'new-system',
            },
          },
        ],
      }),
    )
    const history = await loadChatHistory('chat-meta')
    expect(history!.createdAt).toBe('2026-09-13T00:00:00Z')
    expect(history!.designSystemId).toBe('new-system')
    expect(history!.name).toBe('first')
  })

  it('never throws — returns null on a network failure', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error('network down') })
    expect(await loadChatHistory('chat-err')).toBeNull()
  })

  it('ignores rows belonging to a different chat_id (defensive filter)', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        data: [
          { row_data: { chat_id: 'other-chat', prompt: 'x', generated_code: 'y', created_at: '2026-09-13T00:00:00Z' } },
        ],
      }),
    )
    const history = await loadChatHistory('chat-real')
    expect(history).toBeNull()
  })
})
