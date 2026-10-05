import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they
// must be set BEFORE the import executes. vi.hoisted() runs above imports.
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { resolveSlugByChatId, resolveDbProject } from '@/lib/build/app-registry'

function rowsResponse(rows: any[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function failResponse(status = 500): Response {
  return { ok: false, status, json: async () => ({}), text: async () => '' } as unknown as Response
}
function row(slug: string, extra: Record<string, unknown> = {}): any {
  return { slug, chatId: `chat-${slug}`, createdAt: '2026-08-01T00:00:00Z', ...extra }
}

// =======================================
// resolveSlugByChatId (reverse lookup)
// =======================================
describe('resolveSlugByChatId (#331)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns null when chatId is empty (no fetch)', async () => {
    const result = await resolveSlugByChatId('')
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps a chatId back to its company slug', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme'), row('other')]))
    const result = await resolveSlugByChatId('chat-acme')
    expect(result).toBe('acme')
  })

  it('returns null when no row has that chatId', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')]))
    const result = await resolveSlugByChatId('chat-ghost')
    expect(result).toBeNull()
  })

  it('latest-wins when the same chatId maps to a re-registered slug', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([
        { slug: 'old-slug', chatId: 'chat-x', createdAt: '2026-07-01T00:00:00Z' },
        { slug: 'new-slug', chatId: 'chat-x', createdAt: '2026-08-10T00:00:00Z' },
      ]),
    )
    const result = await resolveSlugByChatId('chat-x')
    expect(result).toBe('new-slug')
  })

  it('treats a soft-deleted company (lifecycleStatus=deleted) as gone', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { lifecycleStatus: 'deleted' })]))
    const result = await resolveSlugByChatId('chat-acme')
    expect(result).toBeNull()
  })

  it('returns null without throwing on a non-ok response', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(failResponse())
    const result = await resolveSlugByChatId('chat-acme')
    expect(result).toBeNull()
  })

  it('returns null without throwing when fetch rejects', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const result = await resolveSlugByChatId('chat-acme')
    expect(result).toBeNull()
  })
})

// =======================================
// resolveDbProject (slug → projectId seam)
// =======================================
describe('resolveDbProject (#331)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('returns source=none with null projectId for an empty slug (no fetch)', async () => {
    const result = await resolveDbProject('')
    expect(result).toEqual({ projectId: null, source: 'none' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns source=none when the slug has no provisioned project', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme')])) // no zerodbProjectId
    const result = await resolveDbProject('acme')
    expect(result).toEqual({ projectId: null, source: 'none' })
  })

  it('returns the provisioned zerodbProjectId with source=registry', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([row('acme', { zerodbProjectId: 'proj-acme-123' })]))
    const result = await resolveDbProject('acme')
    expect(result).toEqual({ projectId: 'proj-acme-123', source: 'registry' })
  })

  it('degrades to source=none (no throw) when the registry lookup fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network'))
    const result = await resolveDbProject('acme')
    expect(result).toEqual({ projectId: null, source: 'none' })
  })
})
