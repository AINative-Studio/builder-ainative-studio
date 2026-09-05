import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #536 — createProject's POST body must send the CURRENT default project
 * tier ('hobbyist'), not the retired 'free' value. Core #128 removed the
 * free plan; Hobbyist ($5, 7-day trial) is the entry tier that replaced it
 * (see lib/ainative/plan.ts's normalizeTier, which only accepts 'free' as a
 * legacy INBOUND value to normalize away from, never a value to send out).
 */

const h = vi.hoisted(() => ({
  ainativeFetch: vi.fn(
    async (_path: string, _token: string, _opts: { method?: string; body?: any }) => ({
      id: 'proj_1',
    }),
  ),
}))

vi.mock('@/lib/ainative/client', () => ({ ainativeFetch: h.ainativeFetch }))

import { createProject } from '@/lib/ainative/projects'

describe('createProject tier payload (#536)', () => {
  beforeEach(() => {
    h.ainativeFetch.mockClear()
  })

  it('defaults tier to hobbyist, never the retired free value', async () => {
    await createProject('token', { name: 'my-app' })

    expect(h.ainativeFetch).toHaveBeenCalledTimes(1)
    const [path, token, opts] = h.ainativeFetch.mock.calls[0]
    expect(path).toBe('/api/v1/projects')
    expect(token).toBe('token')
    expect(opts.method).toBe('POST')
    expect(opts.body.tier).toBe('hobbyist')
    expect(opts.body.tier).not.toBe('free')
  })

  it('a caller-supplied tier still overrides the default', async () => {
    await createProject('token', { name: 'my-app', tier: 'pro' })

    const [, , opts] = h.ainativeFetch.mock.calls[0]
    expect(opts.body.tier).toBe('pro')
  })

  it('always sets database_enabled true alongside the default tier', async () => {
    await createProject('token', { name: 'my-app' })

    const [, , opts] = h.ainativeFetch.mock.calls[0]
    expect(opts.body.database_enabled).toBe(true)
  })
})
