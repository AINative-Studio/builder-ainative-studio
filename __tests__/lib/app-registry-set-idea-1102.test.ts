import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppIdea } from '@/lib/build/app-registry'
import { __resetRegistryCacheForTests } from '@/lib/build/app-registry'

/**
 * #1102/#1113 — setAppIdea(): backfills `idea` onto a registry row created
 * before #660's idea-persistence fix shipped. Mirrors setAppDomain's exact
 * resolveApp -> registerApp append pattern (see app-registry-core.test.ts's
 * setAppDomain suite) with one extra rule: never overwrite a row that
 * already has a real idea.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('setAppIdea (#1102/#1113)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns false when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppIdea('ghost', 'some idea')
    expect(ok).toBe(false)
  })

  it('writes the idea onto a row that has none', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(rowsResponse([row('habanero-hub')])) // resolveApp read
      .mockResolvedValueOnce(okResponse()) // registerApp write
    const ok = await setAppIdea('habanero-hub', 'A subscription box for hot sauce makers.')
    expect(ok).toBe(true)
    // The write call is the second fetch — assert the posted body carries the new idea.
    const writeCall = fetchMock.mock.calls[1]
    const body = JSON.parse((writeCall[1] as RequestInit).body as string)
    expect(body.row_data.idea).toBe('A subscription box for hot sauce makers.')
  })

  it('never overwrites a row that already has a real idea (returns true as a no-op, no write call)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([row('groundwork', { idea: 'already the real idea' })]),
    )
    const ok = await setAppIdea('groundwork', 'a different idea that should never land')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the resolveApp read — no write
  })
})
