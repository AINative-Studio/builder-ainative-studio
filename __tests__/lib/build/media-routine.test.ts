import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runMediaRoutines } from '@/lib/build/media-routine'

/**
 * #54 — media routine runner (the nightly-loop hook). Verifies it is inert when
 * generation is unconfigured, only runs DUE routines, advances routines forward,
 * and never throws. The underlying media-schedule I/O is mocked at global.fetch so
 * no network is touched.
 */

const OK = (json: unknown) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) })

const routineRow = (over: Record<string, unknown> = {}) => ({
  row_data: {
    id: `r_${Math.random().toString(36).slice(2)}`,
    rowKind: 'routine',
    mediaKind: 'image',
    frequency: 'daily',
    enabled: true,
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  },
})

describe('runMediaRoutines', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    process.env.ZERODB_API_KEY = 'k'
    process.env.AINATIVE_API_KEY = 'k'
    vi.restoreAllMocks()
  })
  afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks() })

  it('is inert (generated 0) when media generation is unconfigured', async () => {
    process.env.BUILD_MEDIA_ENABLED = ''
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaRoutines('a::b', { companyName: 'Acme' })
    expect(res).toEqual({ generated: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 0 with no scope', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    expect(await runMediaRoutines('', {})).toEqual({ generated: 0 })
  })

  it('generates for a DUE routine and advances it (recurring stays enabled)', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    // A daily routine that last ran long ago → due.
    const rows = [routineRow({ lastRunAt: '2026-01-01T00:00:00Z', frequency: 'daily' })]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ data: rows }) as any)              // listMedia
      .mockResolvedValueOnce(OK({ url: 'http://x/g.png' }) as any)   // generate
      .mockResolvedValueOnce(OK({ ok: true }) as any)               // saveAsset
      .mockResolvedValueOnce(OK({ ok: true }) as any)               // saveRoutine advance
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaRoutines('a::b', { companyName: 'Acme' })
    expect(res.generated).toBe(1)
    // Last write is the advance — a recurring routine should remain enabled.
    const advanceBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
    expect(advanceBody.row_data.enabled).toBe(true)
    expect(advanceBody.row_data.lastRunAt).toBeTruthy()
  })

  it('skips routines that are NOT due', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    // A weekly routine that just ran → not due.
    const rows = [routineRow({ frequency: 'weekly', lastRunAt: new Date().toISOString() })]
    const fetchMock = vi.fn().mockResolvedValueOnce(OK({ data: rows }) as any) // only listMedia
    vi.stubGlobal('fetch', fetchMock)
    const res = await runMediaRoutines('a::b', {})
    expect(res.generated).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("advances a 'once' routine to disabled after it fires", async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    const rows = [routineRow({ frequency: 'once', lastRunAt: undefined })] // never run → due
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(OK({ data: rows }) as any)
      .mockResolvedValueOnce(OK({ url: 'http://x/g.png' }) as any)
      .mockResolvedValueOnce(OK({ ok: true }) as any)
      .mockResolvedValueOnce(OK({ ok: true }) as any)
    vi.stubGlobal('fetch', fetchMock)
    await runMediaRoutines('a::b', {})
    const advanceBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body)
    expect(advanceBody.row_data.enabled).toBe(false)
  })

  it('never throws when listing fails', async () => {
    process.env.BUILD_MEDIA_ENABLED = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    await expect(runMediaRoutines('a::b', {})).resolves.toEqual({ generated: 0 })
  })
})
