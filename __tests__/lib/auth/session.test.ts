import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  cookies: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: h.cookies,
}))

import { getSession, requireSession } from '@/lib/auth/session'

describe('lib/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getSession()', () => {
    it('returns null when there is no session cookie', async () => {
      h.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })

      const result = await getSession()

      expect(result).toBeNull()
    })

    it('returns a demo session when a session cookie is present', async () => {
      h.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'cookie-value' }) })

      const result = await getSession()

      expect(result).toEqual({
        user: { id: 'demo-user', email: 'demo@example.com', name: 'Demo User' },
      })
    })

    it('returns null and logs when cookies() throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.cookies.mockRejectedValue(new Error('cookie store unavailable'))

      const result = await getSession()

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith('Session error:', expect.any(Error))
      errorSpy.mockRestore()
    })
  })

  describe('requireSession()', () => {
    it('returns the session when one exists', async () => {
      h.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'cookie-value' }) })

      const session = await requireSession()

      expect(session.user?.id).toBe('demo-user')
    })

    it('throws an Unauthorized error when no session cookie exists', async () => {
      h.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })

      await expect(requireSession()).rejects.toThrow('Unauthorized - Session required')
    })

    it('throws an Unauthorized error when getSession fails internally', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      h.cookies.mockRejectedValue(new Error('boom'))

      await expect(requireSession()).rejects.toThrow('Unauthorized - Session required')
      errorSpy.mockRestore()
    })
  })
})
