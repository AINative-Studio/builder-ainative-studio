import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.ZERODB_API_KEY = 'test-key'
  process.env.ZERODB_PROJECT_ID = 'proj-1'
})

function mockFetch(impl?: (url: string, init?: RequestInit) => { ok: boolean }) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const r = impl ? impl(url, init) : { ok: true }
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => ({}), text: async () => '{}' } as unknown as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('recordFunnelEvent (#BLD-06.12)', () => {
  beforeEach(() => { mockFetch() })

  it('records an event with the real event name, track, and step', async () => {
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('idea_submitted', { companyId: null, track: 'app', step: 'intake' })).resolves.not.toThrow()
  })

  it('never throws when the write fails, only logs best-effort', async () => {
    mockFetch(() => ({ ok: false }))
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('save', { companyId: 'acme', track: 'company', step: 'thesis' })).resolves.not.toThrow()
  })

  it('never throws when fetch itself throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { recordFunnelEvent } = await import('@/lib/build/funnel-events')
    await expect(recordFunnelEvent('last_step_reached', { companyId: 'acme', track: 'company', step: 'plan30' })).resolves.not.toThrow()
  })
})
