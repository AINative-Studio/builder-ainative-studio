import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/evidence/[id]/artifacts (#1213) — lists artifacts for a given
 * evidence row. Was ALSO orphaned (nothing in evidence-gallery.tsx or
 * evidence-timeline.tsx called it) until the gallery's Download button was
 * wired through it in the same change that fixes GET /api/artifacts/[id].
 */

const dbMock = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({ artifacts: {} }))

function getReq(id: string) {
  return {} as unknown as NextRequest
}

describe('GET /api/evidence/[id]/artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the real artifacts for an evidence row', async () => {
    dbMock.select.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([{ id: 'a1', name: 'log.txt' }, { id: 'a2', name: 'coverage.html' }]),
      }),
    })

    const { GET } = await import('@/app/api/evidence/[id]/artifacts/route')
    const res = await GET(getReq('ev-1'), { params: Promise.resolve({ id: 'ev-1' }) })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.artifacts).toHaveLength(2)
  })

  it('returns an empty list (not an error) when there are no artifacts yet', async () => {
    dbMock.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) })

    const { GET } = await import('@/app/api/evidence/[id]/artifacts/route')
    const res = await GET(getReq('ev-2'), { params: Promise.resolve({ id: 'ev-2' }) })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.artifacts).toEqual([])
  })

  it('returns a clean 500 (not a crash) when the query throws', async () => {
    dbMock.select.mockReturnValue({ from: () => ({ where: () => Promise.reject(new Error('db down')) }) })

    const { GET } = await import('@/app/api/evidence/[id]/artifacts/route')
    const res = await GET(getReq('ev-3'), { params: Promise.resolve({ id: 'ev-3' }) })

    expect(res.status).toBe(500)
  })
})
