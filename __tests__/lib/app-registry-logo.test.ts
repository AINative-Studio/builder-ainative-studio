import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// app-registry.ts captures API_KEY + PROJECT_ID at MODULE LOAD (const), so they must
// be set BEFORE the import executes (see app-registry-railway.test.ts).
vi.hoisted(() => {
  process.env.AINATIVE_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-abc'
})

import { setAppLogo } from '@/lib/build/app-registry'

/**
 * #492 — setAppLogo persists a founder's uploaded logo/brand-mark url on the
 * company record and is idempotent: re-writing the SAME logoUrl + fileId is a
 * no-op (returns true, no POST) so re-reading the current logo never appends a
 * churn row. Fetch is mocked so no real ZeroDB call is made.
 */
function rowsResponse(rows: any[]): Response {
  return {
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: rows.map((r) => ({ row_data: r })) }),
  } as unknown as Response
}
function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } as unknown as Response
}

describe('setAppLogo (#492)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('no-op (false) when the slug is not registered', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(rowsResponse([]))
    const ok = await setAppLogo('ghost', { logoUrl: '/api/build/logo?id=abc' })
    expect(ok).toBe(false)
  })

  it('no-op (false) when no logoUrl provided (no fetch)', async () => {
    const ok = await setAppLogo('acme', { logoUrl: '' })
    expect(ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('writes a row carrying the logo url and file id', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{ slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z' }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppLogo('acme', {
      logoUrl: '/api/build/logo?id=bca483b8-8c88-46a7-b226-bcfedf3c8a15',
      logoFileId: 'bca483b8-8c88-46a7-b226-bcfedf3c8a15',
    })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.logoUrl).toBe('/api/build/logo?id=bca483b8-8c88-46a7-b226-bcfedf3c8a15')
    expect(body.row_data.logoFileId).toBe('bca483b8-8c88-46a7-b226-bcfedf3c8a15')
    expect(body.row_data.logoUpdatedAt).toBeTruthy()
  })

  it('preserves existing brand fields (name/tagline/color) on the appended row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        name: 'Acme', tagline: 'We make things', color: '#2f6d86',
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc' })
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.name).toBe('Acme')
    expect(body.row_data.tagline).toBe('We make things')
    expect(body.row_data.color).toBe('#2f6d86')
  })

  it('is idempotent — same logoUrl + fileId writes NO new row', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        logoUrl: '/api/build/logo?id=abc', logoFileId: 'abc',
      }]),
    )
    const ok = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=abc', logoFileId: 'abc' })
    expect(ok).toBe(true)
    // No POST — nothing changed.
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('writes a new row when the logo is replaced (different fileId)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      rowsResponse([{
        slug: 'acme', chatId: 'chat-1', createdAt: '2026-08-01T00:00:00Z',
        logoUrl: '/api/build/logo?id=old', logoFileId: 'old',
      }]),
    )
    fetchMock.mockResolvedValueOnce(okResponse())
    const ok = await setAppLogo('acme', { logoUrl: '/api/build/logo?id=new', logoFileId: 'new' })
    expect(ok).toBe(true)
    const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'))
    expect(body.row_data.logoFileId).toBe('new')
  })
})
