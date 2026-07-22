/**
 * "Sign in with AINative" — OAuth 2.1 authorization-code + PKCE helpers.
 *
 * AINative core is a full OAuth2.1/OIDC provider (see ~/core/src/backend/app):
 *   - GET  /oauth/authorize   (PKCE S256 enforced)
 *   - POST /v1/oauth/token    (authorization_code | refresh_token)
 *   - GET  /oauth/userinfo    (OIDC: sub, email, name, plan, organization_id)
 *
 * The builder registers as an OAuth client (client_id in core KNOWN_CLIENTS /
 * oauth_clients). This module only builds/validates the flow; the route
 * handlers under app/api/auth/ainative/* drive it.
 */
import { createHash, randomBytes } from 'crypto'
import { AINATIVE_API_BASE_URL } from '@/lib/constants'

export const AINATIVE_OAUTH = {
  authorizeUrl: `${AINATIVE_API_BASE_URL}/oauth/authorize`,
  tokenUrl: `${AINATIVE_API_BASE_URL}/v1/oauth/token`,
  userinfoUrl: `${AINATIVE_API_BASE_URL}/oauth/userinfo`,
  scope: 'openid profile email',
} as const

/** OAuth client id for the builder — registered in core's oauth_clients. */
export function getClientId(): string {
  return process.env.AINATIVE_OAUTH_CLIENT_ID || ''
}

/** Optional confidential-client secret (public/PKCE clients omit it). */
export function getClientSecret(): string | undefined {
  return process.env.AINATIVE_OAUTH_CLIENT_SECRET || undefined
}

/** The builder's callback URL registered as an allowed redirect_uri. */
export function getRedirectUri(): string {
  const base =
    process.env.AINATIVE_OAUTH_REDIRECT_URI ||
    (process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL.replace(/\/$/, '')}/api/auth/ainative/callback`
      : '')
  return base
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 7636 PKCE pair (S256). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Opaque anti-CSRF state token. */
export function createState(): string {
  return base64url(randomBytes(16))
}

/** Build the /oauth/authorize redirect URL. */
export function buildAuthorizeUrl(params: {
  state: string
  codeChallenge: string
}): string {
  const url = new URL(AINATIVE_OAUTH.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', getClientId())
  url.searchParams.set('redirect_uri', getRedirectUri())
  url.searchParams.set('scope', AINATIVE_OAUTH.scope)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  scope?: string
}

/** Exchange an authorization code (+PKCE verifier) for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: getClientId(),
    code_verifier: codeVerifier,
  }
  const secret = getClientSecret()
  if (secret) body.client_secret = secret

  const res = await fetch(AINATIVE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AINative token exchange failed (${res.status}): ${text}`)
  }
  return res.json()
}

export interface OAuthUserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  plan?: string
  /** Primary workspace (Organization). Full list via /api/v1/workspaces. */
  organization_id?: string
  account_id?: string
}

/** OIDC userinfo lookup with the freshly minted access token. */
export async function fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
  const res = await fetch(AINATIVE_OAUTH.userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AINative userinfo failed (${res.status}): ${text}`)
  }
  return res.json()
}

export function isOAuthConfigured(): boolean {
  return Boolean(getClientId() && getRedirectUri())
}
