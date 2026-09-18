import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#796 — GET /api/auth/ainative/callback must resolve `workspaceId`
 * from /oauth/userinfo's ordered `organizations[]` list (core#7666), not the
 * raw `organization_id` scalar, which uses a different, unrelated resolver
 * and ordering on this specific endpoint (core refs #5730/#5233 vs #7666) and
 * is not guaranteed to match `organizations[0]`.
 *
 * We mock every network collaborator (token exchange, userinfo, NextAuth
 * signIn) and the PKCE/state cookies, then assert the exact `workspaceId`
 * handed to `signIn('ainative-oauth', ...)` for several userinfo shapes.
 */

const h = vi.hoisted(() => ({
  exchangeCodeForTokens: vi.fn(),
  fetchUserInfo: vi.fn(),
  signIn: vi.fn(async () => undefined),
  cookieStore: new Map<string, string>(),
}))

vi.mock('@/lib/auth/ainative-oauth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/ainative-oauth')>(
    '@/lib/auth/ainative-oauth',
  )
  return {
    ...actual,
    exchangeCodeForTokens: h.exchangeCodeForTokens,
    fetchUserInfo: h.fetchUserInfo,
  }
})

vi.mock('@/app/(auth)/auth', () => ({ signIn: h.signIn }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = h.cookieStore.get(name)
      return value === undefined ? undefined : { value }
    },
  }),
}))

import { GET } from '@/app/api/auth/ainative/callback/route'

function callbackRequest(): Request {
  return new Request(
    'https://builder.ainative.studio/api/auth/ainative/callback?code=abc123&state=state-1',
  ) as any
}

describe('GET /api/auth/ainative/callback — org resolution (builder#796)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.cookieStore.clear()
    h.cookieStore.set('ainative_oauth_state', 'state-1')
    h.cookieStore.set('ainative_pkce_verifier', 'verifier-1')
    h.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'access-token-1',
      refresh_token: 'refresh-token-1',
      token_type: 'Bearer',
      expires_in: 3600,
    })
  })

  it('uses organizations[0], not the stale/mismatched organization_id scalar', async () => {
    h.fetchUserInfo.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      organization_id: 'org-scalar-should-be-ignored',
      organizations: [
        { id: 'org-real-default', name: 'AINative Studio', role: 'OWNER', is_default: true },
        { id: 'org-secondary', name: 'Insta-Databases', role: 'ADMIN', is_default: false },
      ],
    })

    await GET(callbackRequest() as any)

    expect(h.signIn).toHaveBeenCalledWith(
      'ainative-oauth',
      expect.objectContaining({ workspaceId: 'org-real-default' }),
    )
  })

  it('falls back to organization_id only when organizations is entirely absent', async () => {
    h.fetchUserInfo.mockResolvedValue({
      sub: 'user-2',
      email: 'legacy@example.com',
      organization_id: 'org-legacy',
    })

    await GET(callbackRequest() as any)

    expect(h.signIn).toHaveBeenCalledWith(
      'ainative-oauth',
      expect.objectContaining({ workspaceId: 'org-legacy' }),
    )
  })

  it('passes an empty workspaceId (not the scalar) when organizations is an empty array', async () => {
    h.fetchUserInfo.mockResolvedValue({
      sub: 'user-3',
      email: 'noorg@example.com',
      organization_id: 'org-should-not-be-used',
      organizations: [],
    })

    await GET(callbackRequest() as any)

    expect(h.signIn).toHaveBeenCalledWith(
      'ainative-oauth',
      expect.objectContaining({ workspaceId: '' }),
    )
  })
})
