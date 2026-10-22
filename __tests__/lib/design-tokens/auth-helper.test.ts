import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1: lib/ pure logic to 80%.
 *
 * lib/design-tokens/auth-helper.ts wraps next-auth's `auth()`. Mocked per
 * this repo's existing convention (see __tests__/lib/require-admin-919.test.ts).
 */

const h = vi.hoisted(() => ({
  auth: vi.fn(),
}))

vi.mock('@/app/(auth)/auth', () => ({ auth: h.auth }))

import { getAuthenticatedUser, requireAuth } from '@/lib/design-tokens/auth-helper'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('#1201 design-tokens auth-helper', () => {
  describe('getAuthenticatedUser', () => {
    it('returns userId and email when session has a user with an id', async () => {
      h.auth.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' } })

      const result = await getAuthenticatedUser()

      expect(result).toEqual({ userId: 'u1', email: 'a@b.com' })
    })

    it('returns null when auth() resolves null', async () => {
      h.auth.mockResolvedValue(null)

      const result = await getAuthenticatedUser()

      expect(result).toBeNull()
    })

    it('returns null when session.user is present but has no id', async () => {
      h.auth.mockResolvedValue({ user: { email: 'a@b.com' } })

      const result = await getAuthenticatedUser()

      expect(result).toBeNull()
    })

    it('returns userId with undefined email when session.user.id is present but email is not', async () => {
      h.auth.mockResolvedValue({ user: { id: 'u2' } })

      const result = await getAuthenticatedUser()

      expect(result).toEqual({ userId: 'u2', email: undefined })
    })
  })

  describe('requireAuth', () => {
    it('resolves to the authenticated user when a valid session exists', async () => {
      h.auth.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com' } })

      const result = await requireAuth()

      expect(result).toEqual({ userId: 'u1', email: 'a@b.com' })
    })

    it('rejects with "Unauthorized" when there is no session', async () => {
      h.auth.mockResolvedValue(null)

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })

    it('rejects with "Unauthorized" when session.user has no id', async () => {
      h.auth.mockResolvedValue({ user: { email: 'a@b.com' } })

      await expect(requireAuth()).rejects.toThrow('Unauthorized')
    })
  })
})
