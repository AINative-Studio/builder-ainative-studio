/**
 * /api/build/zeroinvoice (#418, child of #414) — "Connect ZeroInvoice."
 *
 * ZeroInvoice's real auth is a browser-redirect OAuth 2.1 + PKCE flow that
 * hands the founder off to ZeroInvoice's OWN frontend/dashboard — confirmed
 * via source that builder never receives a token or callback (see
 * lib/build/zeroinvoice.ts's module doc for the full evidence trail). This
 * route's only real job is to fetch the real authorize URL and hand it back
 * for the client to navigate to; it records an HONEST "founder clicked
 * connect" signal, never a confirmed-connected state (builder structurally
 * cannot verify one exists).
 *
 * POST { slug } → { ok, authUrl? } — the caller should redirect/open a new
 * tab to authUrl on success.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppZeroInvoiceConnectClicked } from '@/lib/build/app-registry'
import { getZeroInvoiceAuthorizeUrl } from '@/lib/build/zeroinvoice'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // Connecting a third-party account is a real, account-scoped action on a
  // real, owned company — require sign-in (matches connect-domain's pattern).
  const session = await auth().catch(() => null)
  if (!(session as any)?.accessToken) {
    return Response.json({ ok: false, reason: 'signin' })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  const result = await getZeroInvoiceAuthorizeUrl()
  if (!result.ok || !result.authUrl) {
    return Response.json({ ok: false, reason: result.reason || 'authorize_failed', status: result.status })
  }

  await setAppZeroInvoiceConnectClicked(slug).catch(() => {})

  return Response.json({ ok: true, authUrl: result.authUrl })
}
