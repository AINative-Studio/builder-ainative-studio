import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/artifacts/[id] (#1213) — downloads an artifact file by id, with
 * path-traversal protection. Backing writer confirmed real:
 * evidence-collector.service.ts's db.insert(artifacts).values(...). Had
 * zero frontend callers — the Download button on each evidence-gallery
 * card existed with no onClick at all.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ artifacts: {} }))

const fsMock = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('fs', () => ({ promises: fsMock }))

function selectChain(row: any) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  }
}

function getReq(id: string) {
  return { url: `http://localhost/api/artifacts/${id}` } as unknown as NextRequest
}

describe('GET /api/artifacts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when the artifact row does not exist', async () => {
    dbMock.select.mockReturnValue(selectChain(null))

    const { GET } = await import('@/app/api/artifacts/[id]/route')
    const res = await GET(getReq('missing'), { params: Promise.resolve({ id: 'missing' }) })

    expect(res.status).toBe(404)
  })

  it('downloads a real artifact with the correct headers', async () => {
    dbMock.select.mockReturnValue(
      selectChain({
        id: 'a1',
        name: 'coverage.html',
        mime_type: 'text/html',
        size: 42,
        storage_path: 'ev-1/coverage.html',
      })
    )
    fsMock.readFile.mockResolvedValue(Buffer.from('<html></html>'))

    const { GET } = await import('@/app/api/artifacts/[id]/route')
    const res = await GET(getReq('a1'), { params: Promise.resolve({ id: 'a1' }) })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('Content-Disposition')).toContain('coverage.html')
  })

  it('blocks a path-traversal storage_path, never reading outside the artifacts dir', async () => {
    dbMock.select.mockReturnValue(
      selectChain({
        id: 'a2',
        name: 'evil',
        mime_type: 'text/plain',
        size: 1,
        storage_path: '../../etc/passwd',
      })
    )

    const { GET } = await import('@/app/api/artifacts/[id]/route')
    const res = await GET(getReq('a2'), { params: Promise.resolve({ id: 'a2' }) })

    expect(res.status).toBe(403)
    expect(fsMock.readFile).not.toHaveBeenCalled()
  })

  it('returns 404 (not 500) when the file is missing on disk', async () => {
    dbMock.select.mockReturnValue(
      selectChain({ id: 'a3', name: 'gone.txt', mime_type: 'text/plain', size: 1, storage_path: 'ev-1/gone.txt' })
    )
    const enoent: any = new Error('not found')
    enoent.code = 'ENOENT'
    fsMock.readFile.mockRejectedValue(enoent)

    const { GET } = await import('@/app/api/artifacts/[id]/route')
    const res = await GET(getReq('a3'), { params: Promise.resolve({ id: 'a3' }) })

    expect(res.status).toBe(404)
  })
})
