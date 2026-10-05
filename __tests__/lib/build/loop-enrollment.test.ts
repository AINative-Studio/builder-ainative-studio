import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  enrollCompany,
  setLoopEnabled,
  recordRun,
  listEnrolled,
  getLastRun,
  isEnrolled,
} from '@/lib/build/loop-enrollment'

/**
 * lib/build/loop-enrollment — nightly loop enrollment store (#207/#55).
 * Covers: enrollCompany, setLoopEnabled, recordRun, listEnrolled, getLastRun,
 * isEnrolled — all with mocked fetch. Tests the configuration guard (no-op when
 * ZERODB_API_KEY / ZERODB_PROJECT_ID absent), payload shapes, filtering logic
 * (enabled=true, kind != 'run'), and error paths.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.body ?? {}),
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function makeEnrollmentRow(over: Record<string, unknown> = {}) {
  return {
    row_data: {
      companyId: 'co-1',
      companyName: 'Co One',
      track: 'app',
      enabled: true,
      enrolledAt: '2026-01-01T00:00:00Z',
      ...over,
    },
  }
}

beforeEach(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'test-proj'
  process.env.AINATIVE_API_URL = 'https://test-api.ainative.studio'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
  delete process.env.ZERODB_API_KEY
  delete process.env.ZERODB_PROJECT_ID
  delete process.env.AINATIVE_API_URL
})

// ---------- enrollCompany ----------
describe('enrollCompany', () => {
  it('returns false without calling fetch when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const result = await enrollCompany({ companyId: 'co-1', companyName: 'Co One', track: 'app' })
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs a row with enabled=true and enrolledAt timestamp', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { id: 'row-1' } }))
    const result = await enrollCompany({
      companyId: 'co-1',
      companyName: 'Co One',
      track: 'company',
      goal: 'Scale to 100 customers',
      ownerKey: 'founder@co.com',
    })

    expect(result).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)

    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/database/tables/builder_loop_enrollments/rows')
    expect((init as RequestInit).method).toBe('POST')

    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      companyId: 'co-1',
      companyName: 'Co One',
      track: 'company',
      goal: 'Scale to 100 customers',
      ownerKey: 'founder@co.com',
      enabled: true,
    })
    expect(typeof body.row_data.enrolledAt).toBe('string')
  })

  it('returns false when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const result = await enrollCompany({ companyId: 'co-1', companyName: 'Co', track: 'app' })
    expect(result).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const result = await enrollCompany({ companyId: 'co-1', companyName: 'Co', track: 'app' })
    expect(result).toBe(false)
  })
})

// ---------- setLoopEnabled ----------
describe('setLoopEnabled', () => {
  it('returns false without calling fetch when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const result = await setLoopEnabled('co-1', 'Co One', 'app', true)
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await setLoopEnabled('', 'Co One', 'app', true)
    expect(result).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('appends an enrollment row with enabled=true to re-enroll', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await setLoopEnabled('co-1', 'Co One', 'company', true)

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      companyId: 'co-1',
      companyName: 'Co One',
      track: 'company',
      enabled: true,
    })
  })

  it('appends a row with enabled=false to pause (disable)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await setLoopEnabled('co-1', 'Co One', 'app', false)

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.enabled).toBe(false)
    expect(body.row_data.companyId).toBe('co-1')
  })

  it('returns false when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const result = await setLoopEnabled('co-1', 'Co', 'app', true)
    expect(result).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fail') }))
    const result = await setLoopEnabled('co-1', 'Co', 'app', false)
    expect(result).toBe(false)
  })
})

// ---------- recordRun ----------
describe('recordRun', () => {
  it('does nothing (no fetch) when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    await recordRun('co-1', 'task-1', 'completed')
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs a run-event row with kind="run", enabled=false', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await recordRun('co-1', 'task-abc', 'completed')

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data).toMatchObject({
      kind: 'run',
      companyId: 'co-1',
      lastTaskId: 'task-abc',
      lastStatus: 'completed',
      enabled: false,
    })
    expect(typeof body.row_data.lastRunAt).toBe('string')
  })

  it('handles null taskId (records a run with null lastTaskId)', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    await recordRun('co-1', null, 'failed')

    const body = JSON.parse((fn.mock.calls[0][1] as RequestInit).body as string)
    expect(body.row_data.lastTaskId).toBeNull()
  })

  it('is non-fatal — swallows network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    await expect(recordRun('co-1', 't1', 'ok')).resolves.toBeUndefined()
  })
})

// ---------- listEnrolled ----------
describe('listEnrolled', () => {
  it('returns [] when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const result = await listEnrolled()
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns enabled enrollment rows, excluding run-event rows', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          makeEnrollmentRow({ companyId: 'co-1', enabled: true }), // should include
          makeEnrollmentRow({ companyId: 'co-2', enabled: false }), // disabled → exclude
          makeEnrollmentRow({ companyId: 'co-3', enabled: true, kind: 'run' }), // run event → exclude
          makeEnrollmentRow({ companyId: 'co-4', enabled: true }), // should include
        ],
      },
    }))
    const result = await listEnrolled()
    expect(result.map((r) => r.companyId)).toEqual(['co-1', 'co-4'])
  })

  it('handles a raw array response (no data wrapper)', async () => {
    mockFetch(() => ({
      ok: true,
      body: [
        makeEnrollmentRow({ companyId: 'co-1', enabled: true }),
      ],
    }))
    const result = await listEnrolled()
    expect(result).toHaveLength(1)
    expect(result[0].companyId).toBe('co-1')
  })

  it('returns [] when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    expect(await listEnrolled()).toEqual([])
  })

  it('returns [] (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await listEnrolled()).toEqual([])
  })

  it('fetches with limit=500 param', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { data: [] } }))
    await listEnrolled()
    expect(String(fn.mock.calls[0][0])).toContain('limit=500')
  })

  it('includes rows without kind field (pure enrollment rows)', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          // row without kind field — should be included if enabled
          { row_data: { companyId: 'co-x', companyName: 'Co X', track: 'app', enabled: true, enrolledAt: '2026-01-01' } },
        ],
      },
    }))
    const result = await listEnrolled()
    expect(result).toHaveLength(1)
    expect(result[0].companyId).toBe('co-x')
  })
})

// ---------- getLastRun ----------
describe('getLastRun', () => {
  it('returns null when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    const result = await getLastRun('co-1')
    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns null when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const result = await getLastRun('')
    expect(result).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns the most recent run event for the given companyId', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          {
            row_data: {
              kind: 'run', companyId: 'co-1', lastTaskId: 'task-old',
              lastStatus: 'completed', lastRunAt: '2026-01-01T00:00:01Z',
            },
          },
          {
            row_data: {
              kind: 'run', companyId: 'co-1', lastTaskId: 'task-new',
              lastStatus: 'failed', lastRunAt: '2026-01-01T00:00:05Z',
            },
          },
          {
            row_data: {
              kind: 'run', companyId: 'co-2', lastTaskId: 'task-other',
              lastStatus: 'ok', lastRunAt: '2026-01-01T00:00:10Z',
            },
          },
        ],
      },
    }))
    const result = await getLastRun('co-1')
    expect(result).not.toBeNull()
    expect(result!.lastTaskId).toBe('task-new')
    expect(result!.lastStatus).toBe('failed')
  })

  it('returns null when no run events exist for the company', async () => {
    mockFetch(() => ({
      ok: true,
      body: { data: [makeEnrollmentRow({ companyId: 'co-1', enabled: true })] },
    }))
    const result = await getLastRun('co-1')
    expect(result).toBeNull()
  })

  it('returns null on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    expect(await getLastRun('co-1')).toBeNull()
  })

  it('returns null (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await getLastRun('co-1')).toBeNull()
  })

  it('filters out non-run rows (enrollment rows) for the same company', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          // enrollment row for co-1 (no kind), enabled=true
          { row_data: { companyId: 'co-1', companyName: 'Co', track: 'app', enabled: true, enrolledAt: '2026-01-01' } },
          // run row for co-1
          { row_data: { kind: 'run', companyId: 'co-1', lastTaskId: 't1', lastStatus: 'ok', lastRunAt: '2026-01-02' } },
        ],
      },
    }))
    const result = await getLastRun('co-1')
    expect(result!.lastTaskId).toBe('t1')
  })
})

// ---------- isEnrolled ----------
describe('isEnrolled', () => {
  it('returns false when not configured', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    const fn = mockFetch(() => ({ ok: true }))
    expect(await isEnrolled('co-1')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    expect(await isEnrolled('')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns true when an enabled non-run row exists for the company', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          makeEnrollmentRow({ companyId: 'co-1', enabled: true }),
        ],
      },
    }))
    expect(await isEnrolled('co-1')).toBe(true)
  })

  it('returns false when the company has only a disabled row', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          makeEnrollmentRow({ companyId: 'co-1', enabled: false }),
        ],
      },
    }))
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false when the company only has run-event rows (kind=run)', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          { row_data: { kind: 'run', companyId: 'co-1', enabled: false, lastRunAt: '2026-01-01' } },
        ],
      },
    }))
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false for a different companyId even if another is enrolled', async () => {
    mockFetch(() => ({
      ok: true,
      body: {
        data: [
          makeEnrollmentRow({ companyId: 'co-2', enabled: true }),
        ],
      },
    }))
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('handles a raw array response (no data wrapper)', async () => {
    mockFetch(() => ({
      ok: true,
      body: [
        makeEnrollmentRow({ companyId: 'co-1', enabled: true }),
      ],
    }))
    expect(await isEnrolled('co-1')).toBe(true)
  })
})
