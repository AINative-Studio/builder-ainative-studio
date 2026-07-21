import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  exchangeCodeForTokens,
  fetchUserInfo,
} from '@/lib/auth/ainative-oauth'
import { signIn } from '@/app/(auth)/auth'

export const runtime = 'nodejs'

/**
 * GET /api/auth/ainative/callback?code=...&state=...
 * Completes the OAuth flow: validates state, exchanges the code (+PKCE
 * verifier) for tokens, resolves the user via /oauth/userinfo, then
 * establishes the NextAuth session through the `ainative-oauth` provider —
 * reusing the same JWT/session/workspace plumbing as password login.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  const loginUrl = new URL('/login', url.origin)

  if (oauthError) {
    loginUrl.searchParams.set('error', `ainative_${oauthError}`)
    return NextResponse.redirect(loginUrl)
  }

  const jar = await cookies()
  const expectedState = jar.get('ainative_oauth_state')?.value
  const verifier = jar.get('ainative_pkce_verifier')?.value

  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    loginUrl.searchParams.set('error', 'ainative_invalid_state')
    return NextResponse.redirect(loginUrl)
  }

  try {
    const tokens = await exchangeCodeForTokens(code, verifier)
    const info = await fetchUserInfo(tokens.access_token)

    // Hand the exchanged tokens to the ainative-oauth credentials provider,
    // which builds the session. redirect:false so we control the response and
    // can clear the PKCE cookies.
    await signIn('ainative-oauth', {
      redirect: false,
      sub: info.sub,
      email: info.email ?? '',
      name: info.name ?? info.email ?? '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? '',
      expiresIn: String(tokens.expires_in ?? ''),
      workspaceId: info.organization_id ?? '',
    })

    const res = NextResponse.redirect(new URL('/', url.origin))
    res.cookies.delete('ainative_pkce_verifier')
    res.cookies.delete('ainative_oauth_state')
    return res
  } catch (err) {
    console.error('[AINative OAuth] callback failed:', err)
    loginUrl.searchParams.set('error', 'ainative_exchange_failed')
    return NextResponse.redirect(loginUrl)
  }
}
