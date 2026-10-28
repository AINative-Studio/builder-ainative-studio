import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * #1606 — write-volume cap for auto-renewed (unpaid) trial keys.
 *
 * The invariant these tests protect: a trial-tier project's writes are
 * capped at a configurable threshold, reads are NEVER capped (not this
 * module's concern — it's only ever called from write handlers), a storage/
 * network failure FAILS OPEN (the write proceeds), and the counter persists
 * across calls via a single per-project row, updated in place.
 */

beforeEach(() => {
  vi.resetModules()
  process.env.ZERODB_API_KEY = 'shared-service-key'
  process.env.ZERODB_PROJECT_ID = 'builder-registry-project'
  delete process.env.TRIAL_WRITE_CAP
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function load() {
  return await import('@/lib/build/trial-write-cap')
}

describe('checkAndRecordTrialWrite', () => {
  it('allows the first write for a project with no existing usage row, creating one at count=1', async () => {
    const calls: Array<{ method: string; url: string; body: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        calls.push({ method: init?.method || 'GET', url: u, body: init?.body ? JSON.parse(init.body) : null })
        if (u.includes('/rows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-fresh', 10)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(1)
    expect(result.cap).toBe(10)

    const create = calls.find((c) => c.method === 'POST' && c.url.includes('/rows') && !c.url.includes('?'))
    expect(create).toBeTruthy()
    expect(create!.body.row_data.projectId).toBe('proj-fresh')
    expect(create!.body.row_data.writeCount).toBe(1)
  })

  it('increments an existing counter via PUT-by-row-id, not a new append', async () => {
    const calls: Array<{ method: string; url: string; body: any }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        calls.push({ method: init?.method || 'GET', url: u, body: init?.body ? JSON.parse(init.body) : null })
        if (u.includes('/rows?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ row_id: 'row-abc', row_data: { projectId: 'proj-existing', writeCount: 7, updatedAt: '2026-01-01T00:00:00Z' } }],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-existing', 10)
    expect(result.allowed).toBe(true)
    expect(result.count).toBe(8)

    const update = calls.find((c) => c.method === 'PUT')
    expect(update).toBeTruthy()
    expect(update!.url).toContain('/rows/row-abc')
    expect(update!.body.row_data.writeCount).toBe(8)
    // Never a second POST create once a row already exists.
    const create = calls.find((c) => c.method === 'POST' && c.url.includes('/rows') && !c.url.includes('?'))
    expect(create).toBeUndefined()
  })

  it('DENIES a write once the count has reached the cap — never increments past it', async () => {
    const calls: Array<{ method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        calls.push({ method: init?.method || 'GET' })
        if (u.includes('/rows?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ row_id: 'row-capped', row_data: { projectId: 'proj-capped', writeCount: 10, updatedAt: '2026-01-01T00:00:00Z' } }],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-capped', 10)
    expect(result.allowed).toBe(false)
    expect(result.count).toBe(10)
    expect(result.cap).toBe(10)
    // No PUT/POST write attempted once denied.
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'POST')).toBe(false)
  })

  it('DENIES a write when the count is already PAST the cap (e.g. cap lowered after the fact)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url)
        if (u.includes('/rows?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ row_id: 'row-x', row_data: { projectId: 'proj-over', writeCount: 5001, updatedAt: '2026-01-01T00:00:00Z' } }],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-over', 5000)
    expect(result.allowed).toBe(false)
  })

  it('uses the DEFAULT_TRIAL_WRITE_CAP (5000) when no cap is explicitly passed', async () => {
    const { checkAndRecordTrialWrite, DEFAULT_TRIAL_WRITE_CAP } = await load()
    expect(DEFAULT_TRIAL_WRITE_CAP).toBe(5000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url)
        if (u.includes('/rows?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ row_id: 'row-y', row_data: { projectId: 'proj-default-cap', writeCount: 5000, updatedAt: '2026-01-01T00:00:00Z' } }],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const result = await checkAndRecordTrialWrite('proj-default-cap')
    expect(result.allowed).toBe(false)
  })

  it('honors TRIAL_WRITE_CAP env override for the default', async () => {
    process.env.TRIAL_WRITE_CAP = '42'
    const { DEFAULT_TRIAL_WRITE_CAP } = await load()
    expect(DEFAULT_TRIAL_WRITE_CAP).toBe(42)
  })

  it('FAILS OPEN (allowed:true) when the counter lookup itself fails — never blocks a real write over an unrelated metrics-table outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-outage', 10)
    expect(result.allowed).toBe(true)
  })

  it('FAILS OPEN when the lookup returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-500', 10)
    expect(result.allowed).toBe(true)
  })

  it('still allows the write (fails open) when under cap but the increment PUT/POST itself fails to persist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
        const u = String(url)
        if (u.includes('/rows?')) return { ok: true, status: 200, json: async () => ({ data: [] }) }
        // The create/increment write fails — but the data write must still proceed.
        if (init?.method === 'POST' || init?.method === 'PUT') return { ok: false, status: 500, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-persist-fails', 10)
    expect(result.allowed).toBe(true)
  })

  it('FAILS OPEN (allowed:true, no network call at all) when unconfigured (no service key/project id)', async () => {
    delete process.env.ZERODB_API_KEY
    delete process.env.AINATIVE_API_KEY
    delete process.env.API_Key
    delete process.env.ZERODB_PROJECT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('proj-unconfigured', 10)
    expect(result.allowed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns allowed:true immediately for an empty projectId, no network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { checkAndRecordTrialWrite } = await load()
    const result = await checkAndRecordTrialWrite('', 10)
    expect(result.allowed).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('matches the usage row by projectId, never returns a different project\'s count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any) => {
        const u = String(url)
        if (u.includes('/rows?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { row_id: 'row-a', row_data: { projectId: 'proj-A', writeCount: 10, updatedAt: '2026-01-01T00:00:00Z' } },
                { row_id: 'row-b', row_data: { projectId: 'proj-B', writeCount: 2, updatedAt: '2026-01-01T00:00:00Z' } },
              ],
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    const { checkAndRecordTrialWrite } = await load()
    // proj-A is at its cap (10) — denied.
    expect((await checkAndRecordTrialWrite('proj-A', 10)).allowed).toBe(false)
    // proj-B is NOT at a 10-cap — allowed, uses its OWN count (2), not proj-A's.
    const resultB = await checkAndRecordTrialWrite('proj-B', 10)
    expect(resultB.allowed).toBe(true)
    expect(resultB.count).toBe(3)
  })
})
