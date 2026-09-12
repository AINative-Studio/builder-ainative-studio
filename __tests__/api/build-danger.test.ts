import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #57 / #649 — POST /api/build/danger route.
 *   - requires a REAL (non-guest) session (401 otherwise),
 *   - 400 on an invalid/unconfirmed request (never touches the stores),
 *   - requires the caller to be the REGISTERED OWNER of the company (403
 *     otherwise) — real gap found live (#649): the confirm-matches-name
 *     guard only stops an accidental request, since a company's name/slug is
 *     often publicly visible; it was never a real authorization boundary.
 *     Written before any UI delete control exists, per #649's own mandate:
 *     "The authorization test must be written before the UI control exists.
 *     A destructive endpoint should never rely on a hidden button for its
 *     protection."
 *   - applies a valid, owned action and returns the outcome.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  applyDangerAction: vi.fn(),
  resolveApp: vi.fn(),
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/danger-zone', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, applyDangerAction: h.applyDangerAction }
})
vi.mock('@/lib/build/app-registry', () => ({ resolveApp: h.resolveApp }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { POST } from '@/app/api/build/danger/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

const REAL = { user: { email: 'ada@x.com', type: 'ainative' } }
const OTHER = { user: { email: 'eve@x.com', type: 'ainative' } }
const GUEST = { user: { email: 'guest-1@example.com', type: 'guest' } }

beforeEach(() => {
  h.auth.mockReset()
  h.applyDangerAction.mockReset().mockResolvedValue({ ok: true, action: 'pause', loopChanged: true })
  h.resolveApp.mockReset().mockResolvedValue({ slug: 'acme', ownerEmail: 'ada@x.com' })
})

it('401 when unauthenticated', async () => {
  h.auth.mockResolvedValue(null)
  const res = await POST(req({ action: 'pause', companyId: 'acme' }))
  expect(res.status).toBe(401)
  expect(h.applyDangerAction).not.toHaveBeenCalled()
})

it('401 for a guest session', async () => {
  h.auth.mockResolvedValue(GUEST)
  const res = await POST(req({ action: 'pause', companyId: 'acme' }))
  expect(res.status).toBe(401)
  expect(h.applyDangerAction).not.toHaveBeenCalled()
})

it('400 on an unknown action (never touches stores)', async () => {
  h.auth.mockResolvedValue(REAL)
  const res = await POST(req({ action: 'nuke', companyId: 'acme' }))
  expect(res.status).toBe(400)
  expect(h.applyDangerAction).not.toHaveBeenCalled()
})

it('400 on a destructive action without confirmation', async () => {
  h.auth.mockResolvedValue(REAL)
  const res = await POST(req({ action: 'delete', companyId: 'acme', companyName: 'Acme' }))
  expect(res.status).toBe(400)
  expect(h.applyDangerAction).not.toHaveBeenCalled()
})

describe('ownership authorization (#649)', () => {
  it('403 when the signed-in caller is NOT the company\'s registered owner', async () => {
    h.auth.mockResolvedValue(OTHER) // eve, not ada
    h.resolveApp.mockResolvedValue({ slug: 'acme', ownerEmail: 'ada@x.com' })
    const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
    expect(res.status).toBe(403)
    expect(h.applyDangerAction).not.toHaveBeenCalled()
  })

  it('403 for delete specifically, even with a correct confirm string — confirm alone is not authorization', async () => {
    h.auth.mockResolvedValue(OTHER)
    h.resolveApp.mockResolvedValue({ slug: 'acme', ownerEmail: 'ada@x.com' })
    const res = await POST(req({ action: 'delete', companyId: 'acme', companyName: 'Acme', confirm: 'Acme' }))
    expect(res.status).toBe(403)
    expect(h.applyDangerAction).not.toHaveBeenCalled()
  })

  it('403 when the registry entry has no owner recorded at all (never claimed — not fair game)', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue({ slug: 'acme', ownerEmail: undefined })
    const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
    expect(res.status).toBe(403)
    expect(h.applyDangerAction).not.toHaveBeenCalled()
  })

  it('403 when the company cannot be resolved at all', async () => {
    h.auth.mockResolvedValue(REAL)
    h.resolveApp.mockResolvedValue(null)
    const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
    expect(res.status).toBe(403)
    expect(h.applyDangerAction).not.toHaveBeenCalled()
  })

  it('is case-insensitive when comparing the session email to the recorded owner', async () => {
    h.auth.mockResolvedValue({ user: { email: 'ADA@X.COM', type: 'ainative' } })
    h.resolveApp.mockResolvedValue({ slug: 'acme', ownerEmail: 'ada@x.com' })
    const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
    expect(res.status).toBe(200)
  })
})

it('applies pause and returns the outcome, for the real owner', async () => {
  h.auth.mockResolvedValue(REAL)
  const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ ok: true, action: 'pause', loopChanged: true })
  expect(h.applyDangerAction).toHaveBeenCalledTimes(1)
})

it('applies a confirmed delete for the real owner', async () => {
  h.auth.mockResolvedValue(REAL)
  h.applyDangerAction.mockResolvedValue({ ok: true, action: 'delete', loopChanged: true, lifecycleChanged: true })
  const res = await POST(req({ action: 'delete', companyId: 'acme', companyName: 'Acme', confirm: 'Acme' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.action).toBe('delete')
  const [reqArg] = h.applyDangerAction.mock.calls[0]
  expect(reqArg.action).toBe('delete')
})

it('502 when applying throws', async () => {
  h.auth.mockResolvedValue(REAL)
  h.applyDangerAction.mockRejectedValue(new Error('boom'))
  const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
  expect(res.status).toBe(502)
})
