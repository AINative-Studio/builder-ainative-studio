import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * lib/build/loop-enrollment -- nightly loop enrollment store (#207/#55).
 *
 * API_KEY, PROJECT_ID, and AINATIVE_API are module-level constants frozen at
 * import time. Every test that needs configured() to return true must call
 * vi.resetModules(), set env vars, then dynamic import in that order.
 * Tests verifying unconfigured no-ops reset modules and unset env first.
 */

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const r = impl(String(url), init)
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => (r.body ?? {}),
      text: async () => JSON.stringify(r.body ?? {}),
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// Helper: reset modules, set env, then import configured module
async function freshConfigured() {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'k'
  process.env.ZERODB_PROJECT_ID = 'p'
  process.env.AINATIVE_API_URL = 'https://test-api.ainative.studio'
  return import('@/lib/build/loop-enrollment')
}

// Helper: reset modules, unset env, import unconfigured module
async function freshUnconfigured() {
  vi.resetModules()
  delete process.env.ZERODB_API_KEY
  delete process.env.ZERODB_PROJECT_ID
  delete process.env.AINATIVE_API_URL
  return import('@/lib/build/loop-enrollment')
}

function makeEnrollmentRow(over = {}) {
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

// ---------- enrollCompany ----------
describe('enrollCompany', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
    delete process.env.AINATIVE_API_URL
  })

  it('returns false without fetch when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { enrollCompany } = await freshUnconfigured()
    expect(await enrollCompany({ companyId: 'co-1', companyName: 'Co', track: 'app' })).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs a row with enabled=true and enrolledAt timestamp', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { id: 'r1' } }))
    const { enrollCompany } = await freshConfigured()

    const result = await enrollCompany({ companyId: 'co-1', companyName: 'Co One', track: 'company',
      goal: 'Scale to 100 customers', ownerKey: 'founder@co.com' })

    expect(result).toBe(true)
    const [url, init] = fn.mock.calls[0]
    expect(String(url)).toContain('/database/tables/builder_loop_enrollments/rows')
    expect(init!.method).toBe('POST')
    const body = JSON.parse(init!.body as string)
    expect(body.row_data).toMatchObject({ companyId: 'co-1', companyName: 'Co One', track: 'company',
      goal: 'Scale to 100 customers', ownerKey: 'founder@co.com', enabled: true })
    expect(typeof body.row_data.enrolledAt).toBe('string')
  })

  it('returns false when the API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { enrollCompany } = await freshConfigured()
    expect(await enrollCompany({ companyId: 'co-1', companyName: 'Co', track: 'app' })).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { enrollCompany } = await freshConfigured()
    expect(await enrollCompany({ companyId: 'co-1', companyName: 'Co', track: 'app' })).toBe(false)
  })
})

// ---------- setLoopEnabled ----------
describe('setLoopEnabled', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false without fetch when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { setLoopEnabled } = await freshUnconfigured()
    expect(await setLoopEnabled('co-1', 'Co', 'app', true)).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { setLoopEnabled } = await freshConfigured()
    expect(await setLoopEnabled('', 'Co', 'app', true)).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('appends a row with enabled=true to re-enroll', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { setLoopEnabled } = await freshConfigured()
    await setLoopEnabled('co-1', 'Co One', 'company', true)
    const body = JSON.parse(fn.mock.calls[0][1]!.body as string)
    expect(body.row_data).toMatchObject({ companyId: 'co-1', companyName: 'Co One', track: 'company', enabled: true })
  })

  it('appends a row with enabled=false to pause', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { setLoopEnabled } = await freshConfigured()
    await setLoopEnabled('co-1', 'Co', 'app', false)
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).row_data.enabled).toBe(false)
  })

  it('returns false when API responds non-ok', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { setLoopEnabled } = await freshConfigured()
    expect(await setLoopEnabled('co-1', 'Co', 'app', true)).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fail') }))
    const { setLoopEnabled } = await freshConfigured()
    expect(await setLoopEnabled('co-1', 'Co', 'app', false)).toBe(false)
  })
})

// ---------- recordRun ----------
describe('recordRun', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('does nothing (no fetch) when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { recordRun } = await freshUnconfigured()
    await recordRun('co-1', 'task-1', 'completed')
    expect(fn).not.toHaveBeenCalled()
  })

  it('POSTs a run-event row with kind="run", enabled=false', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { recordRun } = await freshConfigured()
    await recordRun('co-1', 'task-abc', 'completed')
    const body = JSON.parse(fn.mock.calls[0][1]!.body as string)
    expect(body.row_data).toMatchObject({ kind: 'run', companyId: 'co-1',
      lastTaskId: 'task-abc', lastStatus: 'completed', enabled: false })
    expect(typeof body.row_data.lastRunAt).toBe('string')
  })

  it('handles null taskId', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { recordRun } = await freshConfigured()
    await recordRun('co-1', null, 'failed')
    expect(JSON.parse(fn.mock.calls[0][1]!.body as string).row_data.lastTaskId).toBeNull()
  })

  it('is non-fatal -- swallows network errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    const { recordRun } = await freshConfigured()
    await expect(recordRun('co-1', 't1', 'ok')).resolves.toBeUndefined()
  })
})

// ---------- listEnrolled ----------
describe('listEnrolled', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns [] when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { listEnrolled } = await freshUnconfigured()
    expect(await listEnrolled()).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns enabled enrollment rows, excluding disabled and run-event rows', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      makeEnrollmentRow({ companyId: 'co-1', enabled: true }),    // include
      makeEnrollmentRow({ companyId: 'co-2', enabled: false }),   // disabled -- exclude
      makeEnrollmentRow({ companyId: 'co-3', enabled: true, kind: 'run' }), // run event -- exclude
      makeEnrollmentRow({ companyId: 'co-4', enabled: true }),    // include
    ] } }))
    const { listEnrolled } = await freshConfigured()
    const result = await listEnrolled()
    expect(result.map((r) => r.companyId)).toEqual(['co-1', 'co-4'])
  })

  it('handles raw array response (no data wrapper)', async () => {
    mockFetch(() => ({ ok: true, body: [makeEnrollmentRow({ companyId: 'co-1', enabled: true })] }))
    const { listEnrolled } = await freshConfigured()
    const result = await listEnrolled()
    expect(result).toHaveLength(1)
    expect(result[0].companyId).toBe('co-1')
  })

  it('returns [] on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { listEnrolled } = await freshConfigured()
    expect(await listEnrolled()).toEqual([])
  })

  it('returns [] (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { listEnrolled } = await freshConfigured()
    expect(await listEnrolled()).toEqual([])
  })

  it('fetches with limit=500 param', async () => {
    const fn = mockFetch(() => ({ ok: true, body: { data: [] } }))
    const { listEnrolled } = await freshConfigured()
    await listEnrolled()
    expect(String(fn.mock.calls[0][0])).toContain('limit=500')
  })

  it('includes rows without kind field (pure enrollment rows)', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { companyId: 'co-x', companyName: 'Co X', track: 'app', enabled: true, enrolledAt: '2026-01-01' } },
    ] } }))
    const { listEnrolled } = await freshConfigured()
    const result = await listEnrolled()
    expect(result).toHaveLength(1)
    expect(result[0].companyId).toBe('co-x')
  })
})

// ---------- getLastRun ----------
describe('getLastRun', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns null when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { getLastRun } = await freshUnconfigured()
    expect(await getLastRun('co-1')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns null when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { getLastRun } = await freshConfigured()
    expect(await getLastRun('')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns the most recent run event for the given companyId', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { kind: 'run', companyId: 'co-1', lastTaskId: 'task-old',
        lastStatus: 'completed', lastRunAt: '2026-01-01T00:00:01Z' } },
      { row_data: { kind: 'run', companyId: 'co-1', lastTaskId: 'task-new',
        lastStatus: 'failed', lastRunAt: '2026-01-01T00:00:05Z' } },
      { row_data: { kind: 'run', companyId: 'co-2', lastTaskId: 'task-other',
        lastStatus: 'ok', lastRunAt: '2026-01-01T00:00:10Z' } },
    ] } }))
    const { getLastRun } = await freshConfigured()
    const result = await getLastRun('co-1')
    expect(result).not.toBeNull()
    expect(result!.lastTaskId).toBe('task-new')
    expect(result!.lastStatus).toBe('failed')
  })

  it('returns null when no run events exist for the company', async () => {
    mockFetch(() => ({ ok: true, body: { data: [makeEnrollmentRow({ companyId: 'co-1', enabled: true })] } }))
    const { getLastRun } = await freshConfigured()
    expect(await getLastRun('co-1')).toBeNull()
  })

  it('returns null on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { getLastRun } = await freshConfigured()
    expect(await getLastRun('co-1')).toBeNull()
  })

  it('returns null (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { getLastRun } = await freshConfigured()
    expect(await getLastRun('co-1')).toBeNull()
  })

  it('filters out non-run rows for the same company', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { companyId: 'co-1', companyName: 'Co', track: 'app', enabled: true, enrolledAt: '2026-01-01' } },
      { row_data: { kind: 'run', companyId: 'co-1', lastTaskId: 't1', lastStatus: 'ok', lastRunAt: '2026-01-02' } },
    ] } }))
    const { getLastRun } = await freshConfigured()
    const result = await getLastRun('co-1')
    expect(result!.lastTaskId).toBe('t1')
  })
})

// ---------- isEnrolled ----------
describe('isEnrolled', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env.ZERODB_API_KEY
    delete process.env.ZERODB_PROJECT_ID
  })

  it('returns false when not configured', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { isEnrolled } = await freshUnconfigured()
    expect(await isEnrolled('co-1')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns false when companyId is empty', async () => {
    const fn = mockFetch(() => ({ ok: true }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('returns true when an enabled non-run row exists for the company', async () => {
    mockFetch(() => ({ ok: true, body: { data: [makeEnrollmentRow({ companyId: 'co-1', enabled: true })] } }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(true)
  })

  it('returns false when the company has only a disabled row', async () => {
    mockFetch(() => ({ ok: true, body: { data: [makeEnrollmentRow({ companyId: 'co-1', enabled: false })] } }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false when the company only has run-event rows', async () => {
    mockFetch(() => ({ ok: true, body: { data: [
      { row_data: { kind: 'run', companyId: 'co-1', enabled: false, lastRunAt: '2026-01-01' } },
    ] } }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false for a different companyId even if another is enrolled', async () => {
    mockFetch(() => ({ ok: true, body: { data: [makeEnrollmentRow({ companyId: 'co-2', enabled: true })] } }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false on non-ok response', async () => {
    mockFetch(() => ({ ok: false, status: 500 }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('returns false (never throws) when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(false)
  })

  it('handles raw array response (no data wrapper)', async () => {
    mockFetch(() => ({ ok: true, body: [makeEnrollmentRow({ companyId: 'co-1', enabled: true })] }))
    const { isEnrolled } = await freshConfigured()
    expect(await isEnrolled('co-1')).toBe(true)
  })
})
