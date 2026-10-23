import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/auth/ainative-oauth.ts had only 23.86% coverage: the one existing test
 * (__tests__/api/ainative-oauth-callback-org-context.test.ts) mocks this
 * entire module to test a route handler, so it never exercises the module's
 * own logic. This file tests the real implementation directly — PKCE/state
 * generation, authorize-URL building, token exchange, userinfo lookup, and
 * the builder#796/core#7666 default-org resolution — with fetch mocked at
 * the boundary and env vars controlled per test.
 */

const ORIGINAL_ENV = { ...process.env }

describe('#1201 lib/auth/ainative-oauth', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  describe('client config getters', () => {
    it('getClientId reads AINATIVE_OAUTH_CLIENT_ID, defaulting to empty string', async () => {
      const { getClientId } = await import('@/lib/auth/ainative-oauth')
      delete process.env.AINATIVE_OAUTH_CLIENT_ID
      expect(getClientId()).toBe('')

      vi.resetModules()
      process.env.AINATIVE_OAUTH_CLIENT_ID = 'builder-client'
      const mod = await import('@/lib/auth/ainative-oauth')
      expect(mod.getClientId()).toBe('builder-client')
    })

    it('getClientSecret returns undefined when unset, and the value when set', async () => {
      delete process.env.AINATIVE_OAUTH_CLIENT_SECRET
      const { getClientSecret } = await import('@/lib/auth/ainative-oauth')
      expect(getClientSecret()).toBeUndefined()

      vi.resetModules()
      process.env.AINATIVE_OAUTH_CLIENT_SECRET = 'shh'
      const mod = await import('@/lib/auth/ainative-oauth')
      expect(mod.getClientSecret()).toBe('shh')
    })

    it('getRedirectUri prefers the explicit override env var', async () => {
      process.env.AINATIVE_OAUTH_REDIRECT_URI = 'https://explicit.example.com/callback'
      process.env.NEXTAUTH_URL = 'https://should-not-be-used.example.com'
      const { getRedirectUri } = await import('@/lib/auth/ainative-oauth')
      expect(getRedirectUri()).toBe('https://explicit.example.com/callback')
    })

    it('getRedirectUri derives from NEXTAUTH_URL (stripping a trailing slash) when no override is set', async () => {
      delete process.env.AINATIVE_OAUTH_REDIRECT_URI
      process.env.NEXTAUTH_URL = 'https://builder.ainative.studio/'
      const { getRedirectUri } = await import('@/lib/auth/ainative-oauth')
      expect(getRedirectUri()).toBe('https://builder.ainative.studio/api/auth/ainative/callback')
    })

    it('getRedirectUri returns an empty string when neither env var is set', async () => {
      delete process.env.AINATIVE_OAUTH_REDIRECT_URI
      delete process.env.NEXTAUTH_URL
      const { getRedirectUri } = await import('@/lib/auth/ainative-oauth')
      expect(getRedirectUri()).toBe('')
    })
  })

  describe('createPkcePair / createState', () => {
    it('creates a verifier/challenge pair that are base64url (no +, /, or = padding)', async () => {
      const { createPkcePair } = await import('@/lib/auth/ainative-oauth')
      const { verifier, challenge } = createPkcePair()

      expect(verifier).not.toMatch(/[+/=]/)
      expect(challenge).not.toMatch(/[+/=]/)
      expect(verifier.length).toBeGreaterThan(0)
      expect(challenge.length).toBeGreaterThan(0)
    })

    it('derives the challenge deterministically as SHA256(verifier) base64url-encoded', async () => {
      const { createHash } = await import('crypto')
      const { createPkcePair } = await import('@/lib/auth/ainative-oauth')
      const { verifier, challenge } = createPkcePair()

      const expected = createHash('sha256')
        .update(verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      expect(challenge).toBe(expected)
    })

    it('createState returns a non-empty base64url opaque token, different each call', async () => {
      const { createState } = await import('@/lib/auth/ainative-oauth')
      const a = createState()
      const b = createState()
      expect(a).not.toMatch(/[+/=]/)
      expect(a.length).toBeGreaterThan(0)
      expect(a).not.toBe(b)
    })
  })

  describe('buildAuthorizeUrl', () => {
    it('builds a well-formed /oauth/authorize URL with all required PKCE/state params', async () => {
      process.env.AINATIVE_OAUTH_CLIENT_ID = 'builder-client'
      process.env.AINATIVE_OAUTH_REDIRECT_URI = 'https://builder.ainative.studio/api/auth/ainative/callback'
      const { buildAuthorizeUrl } = await import('@/lib/auth/ainative-oauth')

      const url = new URL(
        buildAuthorizeUrl({ state: 'state-xyz', codeChallenge: 'challenge-abc' })
      )

      expect(url.pathname).toBe('/oauth/authorize')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('client_id')).toBe('builder-client')
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://builder.ainative.studio/api/auth/ainative/callback'
      )
      expect(url.searchParams.get('scope')).toBe('openid profile email')
      expect(url.searchParams.get('state')).toBe('state-xyz')
      expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    })
  })

  describe('exchangeCodeForTokens', () => {
    it('exchanges a code+verifier for tokens, omitting client_secret when unset', async () => {
      delete process.env.AINATIVE_OAUTH_CLIENT_SECRET
      process.env.AINATIVE_OAUTH_CLIENT_ID = 'builder-client'
      const { exchangeCodeForTokens } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' }),
      } as Response)

      const result = await exchangeCodeForTokens('auth-code', 'verifier-123')

      expect(result).toEqual({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' })
      const [, init] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toEqual({
        grant_type: 'authorization_code',
        code: 'auth-code',
        redirect_uri: expect.any(String),
        client_id: 'builder-client',
        code_verifier: 'verifier-123',
      })
      expect(body.client_secret).toBeUndefined()
    })

    it('includes client_secret in the body when configured (confidential client)', async () => {
      process.env.AINATIVE_OAUTH_CLIENT_SECRET = 'confidential-secret'
      const { exchangeCodeForTokens } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'at', token_type: 'Bearer' }),
      } as Response)

      await exchangeCodeForTokens('code', 'verifier')

      const [, init] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.client_secret).toBe('confidential-secret')
    })

    it('throws an error including the status and response text on a non-ok response', async () => {
      const { exchangeCodeForTokens } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      } as Response)

      await expect(exchangeCodeForTokens('bad-code', 'verifier')).rejects.toThrow(
        'AINative token exchange failed (400): invalid_grant'
      )
    })

    it('still throws a useful error when reading the error body itself fails', async () => {
      const { exchangeCodeForTokens } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('body read failed')
        },
      } as unknown as Response)

      await expect(exchangeCodeForTokens('code', 'verifier')).rejects.toThrow(
        'AINative token exchange failed (500): '
      )
    })
  })

  describe('fetchUserInfo', () => {
    it('fetches userinfo with a Bearer authorization header', async () => {
      const { fetchUserInfo } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ sub: 'user-1', email: 'a@b.com' }),
      } as Response)

      const result = await fetchUserInfo('access-token-xyz')

      expect(result).toEqual({ sub: 'user-1', email: 'a@b.com' })
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/userinfo'),
        { headers: { Authorization: 'Bearer access-token-xyz' } }
      )
    })

    it('throws a descriptive error on a non-ok userinfo response', async () => {
      const { fetchUserInfo } = await import('@/lib/auth/ainative-oauth')

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_token',
      } as Response)

      await expect(fetchUserInfo('bad-token')).rejects.toThrow(
        'AINative userinfo failed (401): invalid_token'
      )
    })
  })

  describe('resolveDefaultOrganizationId (builder#796, core#7666)', () => {
    it('prefers organizations[0].id when the organizations array is present and non-empty', async () => {
      const { resolveDefaultOrganizationId } = await import('@/lib/auth/ainative-oauth')
      const result = resolveDefaultOrganizationId({
        sub: 'u1',
        organization_id: 'legacy-org',
        organizations: [{ id: 'real-default-org' }, { id: 'other-org' }],
      })
      expect(result).toBe('real-default-org')
    })

    it('returns empty string when organizations is present but empty, NOT falling back to organization_id', async () => {
      const { resolveDefaultOrganizationId } = await import('@/lib/auth/ainative-oauth')
      const result = resolveDefaultOrganizationId({
        sub: 'u1',
        organization_id: 'legacy-org',
        organizations: [],
      })
      expect(result).toBe('')
    })

    it('falls back to organization_id when organizations is entirely absent (older core)', async () => {
      const { resolveDefaultOrganizationId } = await import('@/lib/auth/ainative-oauth')
      const result = resolveDefaultOrganizationId({ sub: 'u1', organization_id: 'legacy-org' })
      expect(result).toBe('legacy-org')
    })

    it('returns empty string when neither organizations nor organization_id is present', async () => {
      const { resolveDefaultOrganizationId } = await import('@/lib/auth/ainative-oauth')
      const result = resolveDefaultOrganizationId({ sub: 'u1' })
      expect(result).toBe('')
    })
  })

  describe('isOAuthConfigured', () => {
    it('returns true only when both client id and redirect uri resolve to a non-empty value', async () => {
      process.env.AINATIVE_OAUTH_CLIENT_ID = 'builder-client'
      process.env.AINATIVE_OAUTH_REDIRECT_URI = 'https://builder.ainative.studio/callback'
      const { isOAuthConfigured } = await import('@/lib/auth/ainative-oauth')
      expect(isOAuthConfigured()).toBe(true)
    })

    it('returns false when the client id is missing', async () => {
      delete process.env.AINATIVE_OAUTH_CLIENT_ID
      process.env.AINATIVE_OAUTH_REDIRECT_URI = 'https://builder.ainative.studio/callback'
      const { isOAuthConfigured } = await import('@/lib/auth/ainative-oauth')
      expect(isOAuthConfigured()).toBe(false)
    })

    it('returns false when the redirect uri cannot be resolved', async () => {
      process.env.AINATIVE_OAUTH_CLIENT_ID = 'builder-client'
      delete process.env.AINATIVE_OAUTH_REDIRECT_URI
      delete process.env.NEXTAUTH_URL
      const { isOAuthConfigured } = await import('@/lib/auth/ainative-oauth')
      expect(isOAuthConfigured()).toBe(false)
    })
  })
})
