import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #57 — POST /api/build/danger route.
 *   - requires a REAL (non-guest) session (401 otherwise),
 *   - 400 on an invalid/unconfirmed request (never touches the stores),
 *   - applies a valid action and returns the outcome.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  applyDangerAction: vi.fn(),
}))
vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/build/danger-zone', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, applyDangerAction: h.applyDangerAction }
})
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }))

import { POST } from '@/app/api/build/danger/route'

function req(body: unknown) {
  return { json: async () => body } as any
}

const REAL = { user: { email: 'ada@x.com', type: 'ainative' } }
const GUEST = { user: { email: 'guest-1@example.com', type: 'guest' } }

beforeEach(() => {
  h.auth.mockReset()
  h.applyDangerAction.mockReset().mockResolvedValue({ ok: true, action: 'pause', loopChanged: true })
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

it('applies pause and returns the outcome', async () => {
  h.auth.mockResolvedValue(REAL)
  const res = await POST(req({ action: 'pause', companyId: 'acme', companyName: 'Acme' }))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ ok: true, action: 'pause', loopChanged: true })
  expect(h.applyDangerAction).toHaveBeenCalledTimes(1)
})

it('applies a confirmed delete', async () => {
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
