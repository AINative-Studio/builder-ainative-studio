import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #919 — admin routes must never authorize via a substring match on email.
 *
 * `requireAdmin()` is the single, shared gate all admin-only routes call.
 * It resolves admin status the same way the rest of Builder already resolves
 * privileged access (#309 staff bypass / #762 plan-resolution consistency):
 * via `fetchCorePlanIdentity()`, which reads core's real `/api/v1/auth/me`
 * role/is_admin/is_superuser fields. There is no local email-pattern check of
 * any kind — an email that merely *contains* "admin" carries no weight.
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchCorePlanIdentity: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/ainative/resolve-plan', () => ({ fetchCorePlanIdentity: h.fetchCorePlanIdentity }))

import { requireAdmin } from '@/lib/auth/require-admin'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#919 requireAdmin', () => {
  it('rejects with no session at all', async () => {
    h.auth.mockResolvedValue(null)

    const result = await requireAdmin()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
    expect(h.fetchCorePlanIdentity).not.toHaveBeenCalled()
  })

  it('rejects an account whose email merely CONTAINS "admin" as a substring but is not a real admin (THE VULNERABILITY)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-1', user: { email: 'notanadmin@foo.com' } })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: false,
      rawPlan: 'hobbyist',
      email: 'notanadmin@foo.com',
    })

    const result = await requireAdmin()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('rejects an "administrator@gmail.com" style account that core does not mark as admin', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-2', user: { email: 'administrator@gmail.com' } })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: false,
      rawPlan: 'pro',
      email: 'administrator@gmail.com',
    })

    const result = await requireAdmin()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('rejects when core plan identity could not be verified (fail closed, never fail open)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-3', user: { email: 'whoever@example.com' } })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: false, admin: false, rawPlan: null, email: null })

    const result = await requireAdmin()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  it('grants access to a real admin account, even with a non-admin-looking email (no regression)', async () => {
    h.auth.mockResolvedValue({
      accessToken: 'jwt-4',
      user: { id: 'user-uuid-4', email: 'founder@realcompany.com' },
    })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'founder@realcompany.com',
    })

    const result = await requireAdmin()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.email).toBe('founder@realcompany.com')
      expect(result.userId).toBe('user-uuid-4')
    }
  })

  it('still grants access when the admin account email happens to contain "admin" (not rejected just for matching the old pattern)', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-5', user: { email: 'admin@ainative.studio' } })
    h.fetchCorePlanIdentity.mockResolvedValue({
      verified: true,
      admin: true,
      rawPlan: 'admin',
      email: 'admin@ainative.studio',
    })

    const result = await requireAdmin()

    expect(result.ok).toBe(true)
  })

  it('never calls fetchCorePlanIdentity when there is no access token on the session (fail closed)', async () => {
    h.auth.mockResolvedValue({ user: { email: 'admin@ainative.studio' } })

    const result = await requireAdmin()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
    expect(h.fetchCorePlanIdentity).not.toHaveBeenCalled()
  })

  it('falls back to the session email when core identity does not report one', async () => {
    h.auth.mockResolvedValue({ accessToken: 'jwt-6', user: { id: 'user-uuid-6', email: 'admin@ainative.studio' } })
    h.fetchCorePlanIdentity.mockResolvedValue({ verified: true, admin: true, rawPlan: 'admin', email: null })

    const result = await requireAdmin()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.email).toBe('admin@ainative.studio')
  })
})
