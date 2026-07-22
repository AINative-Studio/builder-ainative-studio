import { NextResponse } from 'next/server'
import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  isOAuthConfigured,
} from '@/lib/auth/ainative-oauth'

export const runtime = 'nodejs'

/**
 * GET /api/auth/ainative/authorize
 * Starts the "Sign in with AINative" OAuth flow: mints a PKCE pair + state,
 * stashes them in short-lived httpOnly cookies, and redirects to core's
 * /oauth/authorize.
 */
export async function GET() {
  if (!isOAuthConfigured()) {
    return NextResponse.json(
      { error: 'AINative OAuth is not configured (set AINATIVE_OAUTH_CLIENT_ID and redirect URI)' },
      { status: 501 },
    )
  }

  const { verifier, challenge } = createPkcePair()
  const state = createState()

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ state, codeChallenge: challenge }),
  )

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600, // 10 min — matches core's short auth-code window
  }
  res.cookies.set('ainative_pkce_verifier', verifier, cookieOpts)
  res.cookies.set('ainative_oauth_state', state, cookieOpts)

  return res
}
