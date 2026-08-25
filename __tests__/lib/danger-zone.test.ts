import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #57 — Danger Zone logic.
 *   - parseDangerRequest: pure — validates action, requires typed confirmation for
 *     destructive actions, defaults slug to companyId.
 *   - applyDangerAction: maps to the real stores (loop-enrollment + app-registry).
 */
const h = vi.hoisted(() => ({ setLoopEnabled: vi.fn(), setAppLifecycle: vi.fn() }))
vi.mock('@/lib/build/loop-enrollment', () => ({ setLoopEnabled: h.setLoopEnabled }))
vi.mock('@/lib/build/app-registry', () => ({ setAppLifecycle: h.setAppLifecycle }))

import { parseDangerRequest, applyDangerAction } from '@/lib/build/danger-zone'

describe('parseDangerRequest (#57)', () => {
  it('rejects an unknown action', () => {
    const r = parseDangerRequest({ action: 'nuke', companyId: 'acme' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unknown action/i)
  })

  it('requires a companyId', () => {
    const r = parseDangerRequest({ action: 'pause', companyId: '  ' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/companyId/i)
  })

  it('allows pause without confirmation (reversible)', () => {
    const r = parseDangerRequest({ action: 'pause', companyId: 'acme', companyName: 'Acme' })
    expect(r.ok).toBe(true)
    expect(r.value?.action).toBe('pause')
  })

  it('allows resume without confirmation', () => {
    const r = parseDangerRequest({ action: 'resume', companyId: 'acme', companyName: 'Acme' })
    expect(r.ok).toBe(true)
  })

  it('requires a matching confirmation for delete', () => {
    const bad = parseDangerRequest({ action: 'delete', companyId: 'acme', companyName: 'Acme', confirm: 'wrong' })
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/confirmation/i)

    const ok = parseDangerRequest({ action: 'delete', companyId: 'acme', companyName: 'Acme', confirm: 'acme' })
    expect(ok.ok).toBe(true) // matches slug (defaults to companyId)
  })

  it('accepts confirmation matching the company NAME (case-insensitive)', () => {
    const r = parseDangerRequest({ action: 'offline', companyId: 'acme-x', companyName: 'Acme Corp', confirm: 'acme corp' })
    expect(r.ok).toBe(true)
  })

  it('rejects offline without confirmation', () => {
    const r = parseDangerRequest({ action: 'offline', companyId: 'acme', companyName: 'Acme' })
    expect(r.ok).toBe(false)
  })

  it('defaults slug to companyId and track to app', () => {
    const r = parseDangerRequest({ action: 'pause', companyId: 'acme' })
    expect(r.value?.slug).toBe('acme')
    expect(r.value?.track).toBe('app')
  })

  it('honors an explicit slug and company track', () => {
    const r = parseDangerRequest({ action: 'pause', companyId: 'id1', slug: 'acme-slug', track: 'company' })
    expect(r.value?.slug).toBe('acme-slug')
    expect(r.value?.track).toBe('company')
  })
})

describe('applyDangerAction (#57)', () => {
  beforeEach(() => {
    h.setLoopEnabled.mockReset().mockResolvedValue(true)
    h.setAppLifecycle.mockReset().mockResolvedValue(true)
  })

  const base = { companyId: 'acme', companyName: 'Acme', slug: 'acme', track: 'app' as const, confirm: 'acme' }

  it('pause disables the loop', async () => {
    const out = await applyDangerAction({ ...base, action: 'pause' })
    expect(h.setLoopEnabled).toHaveBeenCalledWith('acme', 'Acme', 'app', false)
    expect(h.setAppLifecycle).not.toHaveBeenCalled()
    expect(out).toEqual({ ok: true, action: 'pause', loopChanged: true })
  })

  it('resume re-enables the loop', async () => {
    const out = await applyDangerAction({ ...base, action: 'resume' })
    expect(h.setLoopEnabled).toHaveBeenCalledWith('acme', 'Acme', 'app', true)
    expect(out.loopChanged).toBe(true)
  })

  it('offline sets app lifecycle offline (no loop change)', async () => {
    const out = await applyDangerAction({ ...base, action: 'offline' })
    expect(h.setAppLifecycle).toHaveBeenCalledWith('acme', 'offline')
    expect(h.setLoopEnabled).not.toHaveBeenCalled()
    expect(out.lifecycleChanged).toBe(true)
  })

  it('delete disables the loop AND soft-deletes the app', async () => {
    const out = await applyDangerAction({ ...base, action: 'delete' })
    expect(h.setLoopEnabled).toHaveBeenCalledWith('acme', 'Acme', 'app', false)
    expect(h.setAppLifecycle).toHaveBeenCalledWith('acme', 'deleted')
    expect(out).toEqual({ ok: true, action: 'delete', loopChanged: true, lifecycleChanged: true })
  })

  it('reports partial success honestly when a store is unconfigured', async () => {
    h.setAppLifecycle.mockResolvedValue(false)
    const out = await applyDangerAction({ ...base, action: 'delete' })
    expect(out.loopChanged).toBe(true)
    expect(out.lifecycleChanged).toBe(false)
    expect(out.ok).toBe(true)
  })
})
