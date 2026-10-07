/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('authorizePhoneLogin (#944) — phone-login provider logic', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns null when no accessToken is present', async () => {
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({})
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('builds a session user with a synthetic phone-derived email (review finding #3) and type ainative', async () => {
    // #944 fix-pass (2026-10-06, review finding): email:null broke ~22 call
    // sites across the app that key account identity off session.user.email
    // (my-companies, credits, provision, chat-store's deriveOwnerKey, etc.)
    // — a phone founder would see every authenticated route 401 immediately
    // after a successful sign-in. Mirrors the EXISTING synthetic-email
    // convention guest accounts already use (lib/db/queries.ts:
    // `guest-${guestId}@example.com`) — distinguishable via its own prefix,
    // satisfies every truthy `!email` check, and is a real email string
    // nothing downstream needs to special-case to keep working.
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'u-1', full_name: 'Jordan R', phone: '+15125551234' }) })
      }
      if (url.includes('/api/v1/workspaces')) {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [{ id: 'ws-1', name: 'Jordan R', is_default: true }] }) })
      }
      return Promise.resolve({ ok: false })
    })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-1', refreshToken: 'ref-1', expiresIn: '3600' })
    expect(result).toEqual({
      id: 'u-1',
      email: 'phone-u-1@phone.ainative.studio',
      name: 'Jordan R',
      type: 'ainative',
      accessToken: 'tok-1',
      refreshToken: 'ref-1',
      expiresIn: 3600,
      workspaceId: 'ws-1',
      workspaceName: 'Jordan R',
    })
  })

  it('the synthetic email is stable and unique per account id, not per phone number', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'different-user-id', phone: '+15125551234' }) })
      }
      if (url.includes('/api/v1/workspaces')) {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [] }) })
      }
      return Promise.resolve({ ok: false })
    })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-x' })
    expect(result?.email).toBe('phone-different-user-id@phone.ainative.studio')
  })

  it('falls back to a phone-derived name when /v1/auth/me returns no name', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/v1/auth/me')) {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'u-2', phone: '+15125551234' }) })
      }
      if (url.includes('/api/v1/workspaces')) {
        return Promise.resolve({ ok: true, json: async () => ({ workspaces: [] }) })
      }
      return Promise.resolve({ ok: false })
    })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-2' })
    expect(result?.name).toBe('+15125551234')
  })

  it('returns null, never throws, when /v1/auth/me fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const { authorizePhoneLogin } = await import('@/lib/auth/phone-login')
    const result = await authorizePhoneLogin({ accessToken: 'tok-3' })
    expect(result).toBeNull()
  })
})
