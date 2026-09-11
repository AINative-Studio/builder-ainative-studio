import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * product-generation-state (issue #660 follow-up) — durable {productSlug ->
 * chatId} link, written the moment a company-product generation's chatId is
 * known, so a later request can recover a generation that genuinely
 * succeeded and persisted (see zerodb-store.ts's saveGeneration, awaited
 * before chat-ws emits 'complete') but whose registerApp() call never ran
 * because the background task's container died first (e.g. a Railway
 * redeploy). All ZeroDB REST calls are mocked; no real network call is made.
 */

vi.hoisted(() => {
  process.env.ZERODB_PROJECT_ID = 'test-project'
  process.env.AINATIVE_API_KEY = 'test-key'
})

import {
  recordPendingProductGeneration,
  markProductGenerationRegistered,
  resolvePendingProductGeneration,
} from '@/lib/build/product-generation-state'

function mockFetchSequence(responses: Array<{ ok: boolean; json?: any; text?: string }>) {
  let i = 0
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return {
      ok: r.ok,
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
      json: async () => r.json ?? {},
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordPendingProductGeneration', () => {
  it('writes a pending row with the productSlug/chatId pair', async () => {
    // ensureTable() fires first (idempotent, best-effort), then the real row write.
    const fetchMock = mockFetchSequence([{ ok: true }, { ok: true }])
    await recordPendingProductGeneration('acme-product', 'chat-123')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, rowsInit] = fetchMock.mock.calls[1]
    const body = JSON.parse(String((rowsInit as RequestInit).body))
    expect(body.row_data).toMatchObject({ productSlug: 'acme-product', chatId: 'chat-123', status: 'pending' })
  })

  it('never throws when ZeroDB is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(recordPendingProductGeneration('acme-product', 'chat-123')).resolves.toBeUndefined()
  })

  it('is a no-op when productSlug or chatId is empty', async () => {
    const fetchMock = mockFetchSequence([{ ok: true }])
    await recordPendingProductGeneration('', 'chat-123')
    await recordPendingProductGeneration('acme-product', '')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('markProductGenerationRegistered', () => {
  it('writes a registered row', async () => {
    const fetchMock = mockFetchSequence([{ ok: true }])
    await markProductGenerationRegistered('acme-product', 'chat-123')

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.row_data).toMatchObject({ productSlug: 'acme-product', chatId: 'chat-123', status: 'registered' })
  })
})

describe('resolvePendingProductGeneration', () => {
  it('returns null when no row matches the productSlug', async () => {
    mockFetchSequence([{ ok: true, json: { data: [] } }])
    const result = await resolvePendingProductGeneration('nope-product')
    expect(result).toBeNull()
  })

  it('returns the latest row when the SAME productSlug has multiple rows (append-only, latest-wins)', async () => {
    mockFetchSequence([{
      ok: true,
      json: {
        data: [
          { row_data: { productSlug: 'acme-product', chatId: 'old-chat', status: 'pending', createdAt: '2026-09-10T10:00:00.000Z' } },
          { row_data: { productSlug: 'acme-product', chatId: 'new-chat', status: 'registered', createdAt: '2026-09-10T12:00:00.000Z' } },
          { row_data: { productSlug: 'other-product', chatId: 'unrelated-chat', status: 'pending', createdAt: '2026-09-10T13:00:00.000Z' } },
        ],
      },
    }])
    const result = await resolvePendingProductGeneration('acme-product')
    expect(result).toEqual({ productSlug: 'acme-product', chatId: 'new-chat', status: 'registered', createdAt: '2026-09-10T12:00:00.000Z' })
  })

  it('returns null on a non-ok response, never throwing', async () => {
    mockFetchSequence([{ ok: false }])
    const result = await resolvePendingProductGeneration('acme-product')
    expect(result).toBeNull()
  })

  it('returns null when ZeroDB is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const result = await resolvePendingProductGeneration('acme-product')
    expect(result).toBeNull()
  })
})
