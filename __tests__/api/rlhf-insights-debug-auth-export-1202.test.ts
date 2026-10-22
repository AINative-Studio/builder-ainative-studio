import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1202 (Coverage Phase 3) — four small, previously zero-coverage routes:
 * GET /api/rlhf/insights (ZeroDB-backed aggregate), GET /api/debug-auth
 * (env/auth/db diagnostics), POST /api/export (zip a preview session's
 * files), GET /api/export/[id] (zip a stored generation). All real I/O —
 * ZeroDB, auth(), the db client, the preview store, and the zip exporters —
 * is mocked at the boundary.
 *
 * debug-auth and export/export-by-id each need a different per-test mock
 * for the SAME module path, so those two groups use vi.doMock +
 * vi.resetModules() (the pattern already used in register-phone-route.test.ts)
 * instead of a single top-level vi.mock.
 */

const zerodbStore = vi.hoisted(() => ({ getRLHFInsights: vi.fn() }))
vi.mock('@/lib/zerodb-store', () => zerodbStore)

import { mockGetRequest, mockJsonRequest, mockParams } from '../helpers/api-route-harness'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.doUnmock('@/app/(auth)/auth')
  vi.doUnmock('@/lib/db')
  vi.doUnmock('@/lib/export/project-exporter')
  vi.doUnmock('@/lib/preview-store-v2')
  vi.doUnmock('@/lib/services/export.service')
  vi.resetModules()
})

describe('#1202 GET /api/rlhf/insights', () => {
  it('returns a zeroed placeholder payload when there is no data yet', async () => {
    zerodbStore.getRLHFInsights.mockResolvedValue(null)
    const { GET } = await import('@/app/api/rlhf/insights/route')

    const res = await GET(mockGetRequest('http://localhost/api/rlhf/insights'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totalGenerations).toBe(0)
    expect(body.message).toMatch(/No RLHF data yet/)
  })

  it('returns the real insights with a cache header when data exists', async () => {
    zerodbStore.getRLHFInsights.mockResolvedValue({
      totalGenerations: 42,
      avgRating: 4.2,
      passRate: 90,
      avgCodeLength: 1000,
      modelBreakdown: {},
      categoryBreakdown: {},
    })
    const { GET } = await import('@/app/api/rlhf/insights/route')

    const res = await GET(mockGetRequest('http://localhost/api/rlhf/insights'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=60/)
    const body = await res.json()
    expect(body.totalGenerations).toBe(42)
  })

  it('returns 500 when the ZeroDB call throws', async () => {
    zerodbStore.getRLHFInsights.mockRejectedValue(new Error('zerodb down'))
    const { GET } = await import('@/app/api/rlhf/insights/route')

    const res = await GET(mockGetRequest('http://localhost/api/rlhf/insights'))

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/debug-auth', () => {
  it('reports env flags and successful auth/db module loads', async () => {
    vi.doMock('@/app/(auth)/auth', () => ({ auth: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
    vi.doMock('@/lib/db', () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }) },
    }))
    vi.resetModules()
    const { GET } = await import('@/app/api/debug-auth/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authModuleLoaded).toBe(true)
    expect(body.authCallWorks).toBe(true)
    expect(body.session).toBe('exists')
    expect(body.dbModuleLoaded).toBe(true)
  })

  it('reports a failure when the auth module throws on load', async () => {
    vi.doMock('@/app/(auth)/auth', () => {
      throw new Error('auth module broken')
    })
    vi.doMock('@/lib/db', () => ({ db: null }))
    vi.resetModules()
    const { GET } = await import('@/app/api/debug-auth/route')

    const res = await GET()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authModuleLoaded).toBe(false)
    expect(typeof body.authLoadError).toBe('string')
    expect(body.authLoadError.length).toBeGreaterThan(0)
  })

  it('reports a failure when auth() itself throws', async () => {
    vi.doMock('@/app/(auth)/auth', () => ({
      auth: vi.fn().mockRejectedValue(new Error('auth call broke')),
    }))
    vi.doMock('@/lib/db', () => ({ db: null }))
    vi.resetModules()
    const { GET } = await import('@/app/api/debug-auth/route')

    const res = await GET()

    const body = await res.json()
    expect(body.authCallWorks).toBe(false)
    expect(body.authCallError).toMatch(/auth call broke/)
  })

  it('reports a db module load failure', async () => {
    vi.doMock('@/app/(auth)/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }))
    vi.doMock('@/lib/db', () => {
      throw new Error('db module broken')
    })
    vi.resetModules()
    const { GET } = await import('@/app/api/debug-auth/route')

    const res = await GET()

    const body = await res.json()
    expect(body.dbModuleLoaded).toBe(false)
    expect(typeof body.dbError).toBe('string')
    expect(body.dbError.length).toBeGreaterThan(0)
  })
})

describe('#1202 POST /api/export', () => {
  it('returns 400 when no files are provided and no chatId given', async () => {
    vi.doMock('@/lib/export/project-exporter', () => ({ exportProject: vi.fn() }))
    vi.doMock('@/lib/preview-store-v2', () => ({ getFiles: vi.fn() }))
    vi.resetModules()
    const { POST } = await import('@/app/api/export/route')

    const res = await POST(mockJsonRequest('http://localhost/api/export', {}))

    expect(res.status).toBe(400)
  })

  it('returns 404 when chatId is given but the session is not found', async () => {
    vi.doMock('@/lib/export/project-exporter', () => ({ exportProject: vi.fn() }))
    vi.doMock('@/lib/preview-store-v2', () => ({ getFiles: vi.fn().mockReturnValue(null) }))
    vi.resetModules()
    const { POST } = await import('@/app/api/export/route')

    const res = await POST(mockJsonRequest('http://localhost/api/export', { chatId: 'missing' }))

    expect(res.status).toBe(404)
  })

  it('exports files directly from the body and returns a zip', async () => {
    vi.doMock('@/lib/export/project-exporter', () => ({
      exportProject: vi.fn().mockResolvedValue(Buffer.from('zip-bytes')),
    }))
    vi.doMock('@/lib/preview-store-v2', () => ({ getFiles: vi.fn() }))
    vi.resetModules()
    const { POST } = await import('@/app/api/export/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/export', {
        files: { 'index.ts': 'export default 1' },
        appName: 'My App!',
      })
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('my-app-.zip')
  })

  it('exports files resolved from the preview store via chatId', async () => {
    vi.doMock('@/lib/export/project-exporter', () => ({
      exportProject: vi.fn().mockResolvedValue(Buffer.from('zip-bytes')),
    }))
    vi.doMock('@/lib/preview-store-v2', () => ({
      getFiles: vi.fn().mockReturnValue({ 'index.ts': 'x' }),
    }))
    vi.resetModules()
    const { POST } = await import('@/app/api/export/route')

    const res = await POST(mockJsonRequest('http://localhost/api/export', { chatId: 'c1' }))

    expect(res.status).toBe(200)
  })

  it('returns 500 when exportProject throws', async () => {
    vi.doMock('@/lib/export/project-exporter', () => ({
      exportProject: vi.fn().mockRejectedValue(new Error('zip failed')),
    }))
    vi.doMock('@/lib/preview-store-v2', () => ({ getFiles: vi.fn() }))
    vi.resetModules()
    const { POST } = await import('@/app/api/export/route')

    const res = await POST(
      mockJsonRequest('http://localhost/api/export', { files: { 'a.ts': 'x' } })
    )

    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/export/[id]', () => {
  it('returns 400 when the generation id is empty', async () => {
    vi.doMock('@/lib/services/export.service', () => ({ getExportWithMetadata: vi.fn() }))
    vi.resetModules()
    const { GET } = await import('@/app/api/export/[id]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/export/'),
      mockParams({ id: '' })
    )

    expect(res.status).toBe(400)
  })

  it('streams the zip with the right headers on success', async () => {
    vi.doMock('@/lib/services/export.service', () => ({
      getExportWithMetadata: vi.fn().mockResolvedValue({
        buffer: Buffer.from('zip-bytes'),
        filename: 'gen-1.zip',
        size: 9,
      }),
    }))
    vi.resetModules()
    const { GET } = await import('@/app/api/export/[id]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/export/gen-1'),
      mockParams({ id: 'gen-1' })
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('gen-1.zip')
  })

  it('returns 500 with error details when export fails', async () => {
    vi.doMock('@/lib/services/export.service', () => ({
      getExportWithMetadata: vi.fn().mockRejectedValue(new Error('generation missing')),
    }))
    vi.resetModules()
    const { GET } = await import('@/app/api/export/[id]/route')

    const res = await GET(
      mockGetRequest('http://localhost/api/export/gen-1'),
      mockParams({ id: 'gen-1' })
    )

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.details).toMatch(/generation missing/)
  })
})
