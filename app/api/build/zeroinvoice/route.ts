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
 * POST { slug, action?: 'authorize' | 'confirm' }
 *   'authorize' (default) → { ok, authUrl? } — the caller should redirect/
 *     open a new tab to authUrl on success.
 *   'confirm' → { ok } — real bug fix: the UI had no way to move past
 *     "Connect requested" even after a founder genuinely finished the OAuth
 *     flow in the new tab (builder structurally cannot verify it server-
 *     side). Records the founder's own SELF-reported "I finished connecting"
 *     signal — never presented as platform-verified.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import {
  resolveAppVerified,
  setAppZeroInvoiceConnectClicked,
  setAppZeroInvoiceConnectConfirmed,
} from '@/lib/build/app-registry'
import { getZeroInvoiceAuthorizeUrl } from '@/lib/build/zeroinvoice'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  const action = String(body?.action || 'authorize')
  if (!slug) return Response.json({ ok: false, reason: 'slug required' }, { status: 400 })

  // Connecting a third-party account is a real, account-scoped action on a
  // real, owned company — require sign-in (matches connect-domain's pattern).
  const session = await auth().catch(() => null)
  if (!(session as any)?.accessToken) {
    return Response.json({ ok: false, reason: 'signin' })
  }

  // #832-class bug: resolveApp()'s plain `null` return collapsed "no such
  // company" with "the registry read itself failed" — a transient ZeroDB
  // hiccup here would falsely block a founder from connecting their own
  // company's ZeroInvoice account with "company not found".
  const { entry: app, verified } = await resolveAppVerified(slug).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) return Response.json({ ok: false, reason: 'lookup_failed' }, { status: 503 })
  if (!app) return Response.json({ ok: false, reason: 'company_not_found' }, { status: 404 })

  if (action === 'confirm') {
    const ok = await setAppZeroInvoiceConnectConfirmed(slug).catch(() => false)
    return Response.json({ ok })
  }

  const result = await getZeroInvoiceAuthorizeUrl()
  if (!result.ok || !result.authUrl) {
    return Response.json({ ok: false, reason: result.reason || 'authorize_failed', status: result.status })
  }

  await setAppZeroInvoiceConnectClicked(slug).catch(() => {})

  return Response.json({ ok: true, authUrl: result.authUrl })
}
