import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { resolveAppByChatId, __resetRegistryCacheForTests } from '@/lib/build/app-registry'

/**
 * #1138 — resolveAppByChatId(): reverse-lookup a company by the chatId
 * chat-ws/route.ts already has on every request. Needed so an unresolved
 * obedience-gate compliance gap (checkObedience()) can be filed as a real
 * backlog task scoped to {owner, company} — before this, nothing in the
 * codebase went chatId -> entry; every existing lookup went slug -> entry.
 * Reuses the same real rows-read + client-side collapse listAllAppsWithStatus()
 * already uses (see app-registry-load-status.test.ts and
 * app-registry-resolve-by-zerovoice-744.test.ts) — mocks that same fetch shape.
 */

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}

function failResponse(status = 500): Response {
  return { ok: false, status, text: async () => '{"detail":"error"}' } as unknown as Response
}

function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

describe('resolveAppByChatId (#1138)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); __resetRegistryCacheForTests() })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the matching company when its chatId matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme'), row('other-co')]),
    )
    const result = await resolveAppByChatId('chat-acme')
    expect(result?.slug).toBe('acme')
  })

  it('returns null when no company has a matching chatId (no fallback/default company)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse([row('acme')]))
    const result = await resolveAppByChatId('chat-nonexistent')
    expect(result).toBeNull()
  })

  it('returns null for an empty chatId without calling fetch', async () => {
    const result = await resolveAppByChatId('')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns null when the underlying read fails (never fabricates a match)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(failResponse(500))
    const result = await resolveAppByChatId('chat-acme')
    expect(result).toBeNull()
  })

  it('excludes a soft-deleted company even if its chatId matches', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      rowsResponse([row('acme', { lifecycleStatus: 'deleted' })]),
    )
    const result = await resolveAppByChatId('chat-acme')
    expect(result).toBeNull()
  })

  it('collapses to the latest row per slug before matching (latest-wins)', async () => {
    const rows = [
      row('acme', { chatId: 'chat-old', createdAt: '2026-08-01T00:00:00Z' }),
      row('acme', { chatId: 'chat-new', createdAt: '2026-08-02T00:00:00Z' }),
    ]
    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse(rows))
    // The older row's chatId should no longer match — the newer row replaced it.
    const stale = await resolveAppByChatId('chat-old')
    expect(stale).toBeNull()

    vi.mocked(fetch).mockResolvedValueOnce(rowsResponse(rows))
    const fresh = await resolveAppByChatId('chat-new')
    expect(fresh?.slug).toBe('acme')
  })
})
