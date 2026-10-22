import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * #1202 (Coverage Phase 2, pass 4) — app/api/export/route.ts (zip from
 * in-request files or a stored preview session) and app/api/export/[id]
 * (zip for a stored generation by id) had zero route-level coverage. All
 * real I/O (the project exporter, preview-store-v2, and the export
 * service's DB-backed lookup) is mocked at the module boundary.
 */

const exporter = vi.hoisted(() => ({ exportProject: vi.fn() }))
vi.mock('@/lib/export/project-exporter', () => exporter)

const previewStoreV2 = vi.hoisted(() => ({ getFiles: vi.fn() }))
vi.mock('@/lib/preview-store-v2', () => previewStoreV2)

const exportService = vi.hoisted(() => ({ getExportWithMetadata: vi.fn() }))
vi.mock('@/lib/services/export.service', () => exportService)

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/lib/auth/session', () => sessionMock)

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/db/schema', () => ({ generations: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

function jsonRequest(body: unknown) {
  return new NextRequest('http://localhost/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('#1202 POST /api/export', () => {
  it('returns 400 when no files are provided and no chatId is given', async () => {
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when chatId is given but the session has no stored files', async () => {
    previewStoreV2.getFiles.mockReturnValue(null)
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ chatId: 'missing-session' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Session not found or expired')
  })

  it('returns 400 when the resolved files object is empty', async () => {
    previewStoreV2.getFiles.mockReturnValue({})
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ chatId: 'empty-session' }))
    expect(res.status).toBe(400)
  })

  it('exports files passed directly in the request body', async () => {
    exporter.exportProject.mockResolvedValue(Buffer.from('zip-bytes'))
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ files: { 'index.tsx': 'code' }, appName: 'My App' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('my-app.zip')
    expect(exporter.exportProject).toHaveBeenCalledWith({ 'index.tsx': 'code' }, 'My App')
  })

  it('resolves files from the stored session when chatId is given and no inline files', async () => {
    previewStoreV2.getFiles.mockReturnValue({ 'index.tsx': 'session code' })
    exporter.exportProject.mockResolvedValue(Buffer.from('zip-bytes'))
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ chatId: 'c1' }))

    expect(res.status).toBe(200)
    expect(exporter.exportProject).toHaveBeenCalledWith({ 'index.tsx': 'session code' }, 'AINativeApp')
  })

  it('sanitizes the app name for the Content-Disposition filename', async () => {
    exporter.exportProject.mockResolvedValue(Buffer.from('zip-bytes'))
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ files: { a: 'b' }, appName: 'My Cool App!!' }))

    expect(res.headers.get('Content-Disposition')).toContain('my-cool-app--.zip')
  })

  it('returns 500 when exportProject throws', async () => {
    exporter.exportProject.mockRejectedValue(new Error('zip failed'))
    const { POST } = await import('@/app/api/export/route')
    const res = await POST(jsonRequest({ files: { a: 'b' } }))
    expect(res.status).toBe(500)
  })
})

describe('#1202 GET /api/export/[id]', () => {
  it('returns 400 when the generation id is empty', async () => {
    const { GET } = await import('@/app/api/export/[id]/route')
    const res = await GET({} as any, params(''))
    expect(res.status).toBe(400)
  })

  it('returns a zip stream with the right headers for a valid id', async () => {
    exportService.getExportWithMetadata.mockResolvedValue({
      buffer: Buffer.from('zip-bytes'),
      filename: 'nextjs-app-gen1.zip',
      size: 9,
    })
    const { GET } = await import('@/app/api/export/[id]/route')
    const res = await GET({} as any, params('gen1'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('nextjs-app-gen1.zip')
    expect(res.headers.get('Content-Length')).toBe('9')
  })

  it('returns 500 with error details when the export service throws', async () => {
    exportService.getExportWithMetadata.mockRejectedValue(new Error('generation not found'))
    const { GET } = await import('@/app/api/export/[id]/route')
    const res = await GET({} as any, params('missing-gen'))

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.details).toBe('generation not found')
  })
})
