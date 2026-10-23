import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #1188 — real tool_use handlers for the Live-dashboard "Ask Cody" chat.
 * Mocks only the I/O boundary (resolveApp, resolveCompanyZerodbKey, global
 * fetch) per this session's established convention (see
 * __tests__/api/build-ask-project-resolution.test.ts) — the tool logic itself
 * (scoping, flattening, error shaping) runs for real.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  resolveCompanyZerodbKey: vi.fn(),
}))
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/build/company-zerodb-credentials', () => ({ resolveCompanyZerodbKey: h.resolveCompanyZerodbKey }))

const originalFetch = global.fetch

beforeEach(() => {
  h.resolveApp.mockReset()
  h.resolveCompanyZerodbKey.mockReset()
  global.fetch = originalFetch
  process.env.ZERODB_API_KEY = 'test-shared-key'
  process.env.ZERODB_PROJECT_ID = 'shared-project-id'
})

describe('queryZerodbTable (#1188)', () => {
  it('returns an error without calling fetch when no table name is given', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as any
    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    const result = await queryZerodbTable({ companyId: 'acme' }, {})
    expect(result).toEqual({ table: '', rowCount: 0, rows: [], error: 'table name is required' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads real rows from the COMPANY-SCOPED project using its own stored key, not the shared key', async () => {
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'company-proj-123' })
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: true, apiKey: 'company-scoped-key' })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { row_data: { name: 'Widget', price: 19.99 }, row_id: 'row-1', created_at: '2026-10-01T00:00:00Z' },
          { row_data: { name: 'Gadget', price: 29.99 }, row_id: 'row-2' },
        ],
      }),
    })
    global.fetch = fetchSpy as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    const result = await queryZerodbTable({ companyId: 'acme' }, { table: 'products', limit: 5 })

    expect(h.resolveCompanyZerodbKey).toHaveBeenCalledWith('company-proj-123')
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/v1/projects/company-proj-123/database/tables/products/rows')
    expect((init.headers as any)['X-API-Key']).toBe('company-scoped-key')

    expect(result.table).toBe('products')
    expect(result.rowCount).toBe(2)
    expect(result.rows[0]).toMatchObject({ name: 'Widget', price: 19.99, id: 'row-1' })
    expect(result.error).toBeUndefined()
  })

  it('uses the shared project + shared key for an unprovisioned company (honest legacy fallback)', async () => {
    h.resolveApp.mockResolvedValue(null)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    global.fetch = fetchSpy as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    await queryZerodbTable({ companyId: 'brand-new-co' }, { table: 'waitlist' })

    expect(h.resolveCompanyZerodbKey).not.toHaveBeenCalled()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('/v1/projects/shared-project-id/database/tables/waitlist/rows')
    expect((init.headers as any)['X-API-Key']).toBe('test-shared-key')
  })

  it('NEVER falls back to the shared key when the company has its own project but no stored key (#806 anti-pattern)', async () => {
    h.resolveApp.mockResolvedValue({ zerodbProjectId: 'company-proj-999' })
    h.resolveCompanyZerodbKey.mockResolvedValue({ ok: false, reason: 'not_stored' })
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    const result = await queryZerodbTable({ companyId: 'acme' }, { table: 'products' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.rowCount).toBe(0)
    expect(result.rows).toEqual([])
    expect(result.error).toMatch(/not_stored/)
  })

  it('returns an honest "table does not exist" error on a 404, never fabricated rows', async () => {
    h.resolveApp.mockResolvedValue(null)
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }) as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    const result = await queryZerodbTable({ companyId: 'acme' }, { table: 'ghost_table' })

    expect(result.rowCount).toBe(0)
    expect(result.rows).toEqual([])
    expect(result.error).toContain('does not exist yet')
  })

  it('clamps limit to the 1-20 range', async () => {
    h.resolveApp.mockResolvedValue(null)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    global.fetch = fetchSpy as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    await queryZerodbTable({ companyId: 'acme' }, { table: 'orders', limit: 500 })

    const [url] = fetchSpy.mock.calls[0]
    expect(String(url)).toContain('limit=20')
  })

  it('never throws on a network failure — returns a structured error', async () => {
    h.resolveApp.mockResolvedValue(null)
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as any

    const { queryZerodbTable } = await import('@/lib/build/ask-tools')
    const result = await queryZerodbTable({ companyId: 'acme' }, { table: 'orders' })

    expect(result.rows).toEqual([])
    expect(result.error).toContain('ECONNRESET')
  })
})

describe('getDesignTokens (#1188)', () => {
  it('returns the real stored brand color and logo for a provisioned company', async () => {
    h.resolveApp.mockResolvedValue({
      color: '#FF6B35',
      logoUrl: 'https://builder.ainative.studio/api/logo/acme',
      logoUpdatedAt: '2026-10-10T00:00:00Z',
    })
    const { getDesignTokens } = await import('@/lib/build/ask-tools')
    const result = await getDesignTokens({ companyId: 'acme' })
    expect(result).toEqual({
      hasBrandColor: true,
      color: '#FF6B35',
      hasLogo: true,
      logoUrl: 'https://builder.ainative.studio/api/logo/acme',
      logoUpdatedAt: '2026-10-10T00:00:00Z',
    })
  })

  it('honestly reports no brand color/logo for a company that never set one', async () => {
    h.resolveApp.mockResolvedValue({ name: 'Acme' })
    const { getDesignTokens } = await import('@/lib/build/ask-tools')
    const result = await getDesignTokens({ companyId: 'acme' })
    expect(result.hasBrandColor).toBe(false)
    expect(result.hasLogo).toBe(false)
    expect(result.color).toBeUndefined()
    expect(result.logoUrl).toBeUndefined()
  })

  it('returns a structured error (never throws) when the company is not found', async () => {
    h.resolveApp.mockResolvedValue(null)
    const { getDesignTokens } = await import('@/lib/build/ask-tools')
    const result = await getDesignTokens({ companyId: 'unknown' })
    expect(result.error).toBe('Company not found.')
  })

  it('never throws when resolveApp rejects', async () => {
    h.resolveApp.mockRejectedValue(new Error('zerodb unreachable'))
    const { getDesignTokens } = await import('@/lib/build/ask-tools')
    const result = await getDesignTokens({ companyId: 'acme' })
    expect(result.error).toContain('zerodb unreachable')
  })
})

describe('runAskTool dispatch (#1188)', () => {
  it('dispatches query_zerodb_table and returns isError:false on a real success', async () => {
    h.resolveApp.mockResolvedValue(null)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ row_data: { name: 'Widget' }, row_id: '1' }] }),
    }) as any

    const { runAskTool } = await import('@/lib/build/ask-tools')
    const { result, isError } = await runAskTool('query_zerodb_table', { table: 'products' }, { companyId: 'acme' })
    expect(isError).toBe(false)
    expect((result as any).rows[0]).toMatchObject({ name: 'Widget' })
  })

  it('dispatches get_design_tokens', async () => {
    h.resolveApp.mockResolvedValue({ color: '#000' })
    const { runAskTool } = await import('@/lib/build/ask-tools')
    const { result, isError } = await runAskTool('get_design_tokens', {}, { companyId: 'acme' })
    expect(isError).toBe(false)
    expect((result as any).color).toBe('#000')
  })

  it('returns isError:true for an unknown tool name rather than throwing', async () => {
    const { runAskTool } = await import('@/lib/build/ask-tools')
    const { result, isError } = await runAskTool('delete_everything', {}, { companyId: 'acme' })
    expect(isError).toBe(true)
    expect((result as any).error).toContain('Unknown tool')
  })

  it('marks isError:true for a query_zerodb_table result that has a real table name but still errored (404)', async () => {
    h.resolveApp.mockResolvedValue(null)
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' }) as any
    const { runAskTool } = await import('@/lib/build/ask-tools')
    const { result, isError } = await runAskTool('query_zerodb_table', { table: 'ghost' }, { companyId: 'acme' })
    expect(isError).toBe(true)
    expect((result as any).table).toBe('ghost')
    expect((result as any).error).toContain('does not exist yet')
  })
})
