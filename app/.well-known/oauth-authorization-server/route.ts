/**
 * GET /.well-known/oauth-authorization-server (RFC 8414, AX/agent-readiness
 * scan 2026-09-30) — Builder is a CLIENT of core's real OAuth2.1/PKCE
 * authorization server, not an authorization server itself (see
 * lib/auth/ainative-oauth.ts and app/api/auth/ainative/authorize/route.ts,
 * which already drive this exact flow for "Sign in with AINative"). This
 * document points an external agent at the REAL, already-functioning
 * endpoints those files call — it does not stand up a new auth server.
 *
 * `builder.ainative.studio` itself has no bearer-token API-key scheme; the
 * agent-callable routes documented in /openapi.json either accept anonymous
 * callers or read the NextAuth session cookie this flow produces.
 */

const CORE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

export async function GET() {
  return Response.json(
    {
      issuer: CORE,
      authorization_endpoint: `${CORE}/oauth/authorize`,
      token_endpoint: `${CORE}/v1/oauth/token`,
      userinfo_endpoint: `${CORE}/oauth/userinfo`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['openid', 'profile', 'email'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
