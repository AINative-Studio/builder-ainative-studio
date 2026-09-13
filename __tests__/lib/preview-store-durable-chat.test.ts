import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Chat persistence fix (2026-09-13): getChatData() is in-memory only — a
 * per-process Map wiped on every redeploy/restart, and this is a real
 * multi-instance deployment, so a request landing on a different replica
 * than the one that ran the generation always saw an empty entry too. That
 * silently 404'd /api/chats/[chatId] and, worse, made chat-ws's own
 * "continuation" lookup lose all prior turns with nothing surfaced to the
 * user. getChatDataDurable() checks memory first (fast path), then falls
 * back to the durable ZeroDB reconstruction (lib/zerodb-store.ts's
 * loadChatHistory) and repopulates the in-memory store on a hit.
 */

const loadChatHistoryMock = vi.fn()
vi.mock('@/lib/zerodb-store', () => ({
  loadChatHistory: (...args: unknown[]) => loadChatHistoryMock(...args),
}))

import { storePreview, getChatData, getChatDataDurable } from '@/lib/preview-store'

beforeEach(() => {
  loadChatHistoryMock.mockReset()
})

describe('getChatDataDurable', () => {
  it('returns the in-memory entry without touching ZeroDB when present (fast path)', async () => {
    const id = `durable-mem-${Date.now()}`
    storePreview(id, 'content', 'a message')
    const result = await getChatDataDurable(id)
    expect(result?.messages.length).toBeGreaterThan(0)
    expect(loadChatHistoryMock).not.toHaveBeenCalled()
  })

  it('returns undefined for an empty id without calling ZeroDB', async () => {
    const result = await getChatDataDurable('')
    expect(result).toBeUndefined()
    expect(loadChatHistoryMock).not.toHaveBeenCalled()
  })

  it('falls back to ZeroDB when the in-memory store missed, and reconstructs ChatData', async () => {
    const id = `durable-zerodb-${Date.now()}`
    loadChatHistoryMock.mockResolvedValueOnce({
      messages: [
        { id: `${id}-user-0`, role: 'user', content: 'build a landing page' },
        { id: `${id}-assistant-0`, role: 'assistant', content: 'export default function App(){}' },
      ],
      createdAt: '2026-09-13T00:00:00Z',
      name: 'build a landing page',
      designSystemId: 'cloud',
    })

    // Nothing in memory yet for this id.
    expect(getChatData(id)).toBeUndefined()

    const result = await getChatDataDurable(id)
    expect(result?.messages).toHaveLength(2)
    expect(result?.name).toBe('build a landing page')
    expect(result?.designSystemId).toBe('cloud')
    expect(loadChatHistoryMock).toHaveBeenCalledWith(id)
  })

  it('repopulates the in-memory store on a ZeroDB hit, so a second read is the fast path', async () => {
    const id = `durable-repop-${Date.now()}`
    loadChatHistoryMock.mockResolvedValueOnce({
      messages: [{ id: `${id}-user-0`, role: 'user', content: 'hi' }],
      createdAt: '2026-09-13T00:00:00Z',
    })

    await getChatDataDurable(id)
    expect(getChatData(id)?.messages).toHaveLength(1)

    // A second call must not hit ZeroDB again.
    loadChatHistoryMock.mockClear()
    const second = await getChatDataDurable(id)
    expect(second?.messages).toHaveLength(1)
    expect(loadChatHistoryMock).not.toHaveBeenCalled()
  })

  it('returns undefined (never throws) when ZeroDB has nothing either', async () => {
    const id = `durable-miss-${Date.now()}`
    loadChatHistoryMock.mockResolvedValueOnce(null)
    const result = await getChatDataDurable(id)
    expect(result).toBeUndefined()
  })

  it('returns undefined (never throws) when the ZeroDB call fails', async () => {
    const id = `durable-throw-${Date.now()}`
    loadChatHistoryMock.mockImplementationOnce(async () => { throw new Error('down') })
    const result = await getChatDataDurable(id)
    expect(result).toBeUndefined()
  })
})
