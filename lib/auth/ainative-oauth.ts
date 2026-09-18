/**
 * "Sign in with AINative" — OAuth 2.1 authorization-code + PKCE helpers.
 *
 * AINative core is a full OAuth2.1/OIDC provider (see ~/core/src/backend/app):
 *   - GET  /oauth/authorize   (PKCE S256 enforced)
 *   - POST /v1/oauth/token    (authorization_code | refresh_token)
 *   - GET  /oauth/userinfo    (OIDC: sub, email, name, plan, organization_id,
 *                              organizations[] — full org membership list)
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

/** One org membership entry from /oauth/userinfo's `organizations` list. */
export interface OAuthUserOrganization {
  id: string
  name?: string
  role?: string
  is_default?: boolean
}

export interface OAuthUserInfo {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  plan?: string
  /**
   * Primary workspace (Organization) per a DIFFERENT resolver
   * (resolve_user_organization_id, core refs #5730/#5233) than the
   * `organizations` list below. On this endpoint specifically,
   * `organizations[0]` is NOT guaranteed to equal this scalar — do not
   * assume they match. Prefer `organizations` when it's present.
   */
  organization_id?: string
  /**
   * Full org membership list (core #7666), entries of
   * {id, name, role, is_default}, ordered
   * `COALESCE(is_default, false) DESC, created_at ASC` — so
   * `organizations[0]` is the account's real, deterministic default org.
   * Optional/absent on older core deployments; callers must fall back to
   * `organization_id` when it's missing.
   */
  organizations?: OAuthUserOrganization[]
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

/**
 * Resolve "which org should this OAuth login land in" from userinfo alone.
 *
 * Builder has no server-side visibility into the client-only
 * `ainative.activeWorkspaceId` (localStorage, set by the workspace switcher —
 * see components/workspace-switcher.tsx) at callback time: it's never
 * mirrored to a cookie, so a route handler can't read it. Absent that signal,
 * the account's own ordered default is the only trustworthy choice:
 *   1. `organizations[0]` — real, deterministically ordered default
 *      (is_default first, then oldest). Preferred whenever the array is
 *      present, even if empty (an empty array is a legitimate "no orgs yet"
 *      case, not a signal to fall back to the scalar).
 *   2. `organization_id` — legacy scalar, only used when `organizations` is
 *      entirely absent (older core deployment that hasn't shipped #7666 yet).
 *
 * Refs builder#796, core#7666.
 */
export function resolveDefaultOrganizationId(info: OAuthUserInfo): string {
  if (info.organizations) {
    return info.organizations[0]?.id ?? ''
  }
  return info.organization_id ?? ''
}

export function isOAuthConfigured(): boolean {
  return Boolean(getClientId() && getRedirectUri())
}
