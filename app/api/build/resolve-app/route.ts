/**
 * GET /api/build/resolve-app?slug=... (issue #629/#633, 2026-09-10) — read
 * an app-registry entry by slug. Built as the polling counterpart to
 * /api/build/company-product's decoupled generation: that route now returns
 * immediately with { status: 'processing' } and kicks off the real chat-ws
 * generation as a detached background task (a real generation that needs the
 * primitive-compliance retry, #624-#627, can legitimately run past Railway's
 * edge-proxy request timeout — confirmed live, a genuinely successful
 * generation still came back as a 502 at the 300s mark when this route held
 * the connection open synchronously). The caller polls this endpoint until
 * registerApp lands, instead of one long-held request racing a proxy timeout
 * it has no control over.
 *
 * Returns: { slug, chatId } | { slug, chatId: null } (404 if never resolved
 * — kept 200 either way so a poll loop doesn't have to special-case status)
 *
 * `verified` (#807/#832, additive): true when this response reflects a REAL
 * answer from the registry, false when `resolveApp` itself failed (upstream
 * timeout/error) and `chatId: null` is a "couldn't check" default, not a
 * confirmed miss. Real, reproduced incident: a signed-in customer clicked
 * "Open dashboard" for their own real, existing company and was bounced
 * straight back to the companies screen — `contexts/build-context.tsx`'s
 * `isDeepLinkCompanyNotFound` (correctly, given the old response shape)
 * cannot tell "this company doesn't exist" apart from "resolveApp's own
 * ?limit=1000 registry fetch timed out/errored" — both serialized as the
 * identical `{ chatId: null, idea: null }`. Same anti-pattern class as #830
 * (an internal failure silently collapsed into a confirmed-negative
 * answer). Existing callers that only read `chatId`/`idea` are unaffected;
 * `isDeepLinkCompanyNotFound` now requires `verified: true` before treating
 * a null response as a real miss.
 *

 * `idea` (#660, additive): also returns the founder's original idea when the
 * registry has one, so Live.tsx can hydrate client-only `state.idea` on a
 * fresh page load/new tab/returning visit — without this, its real-product-
 * generation trigger silently never fires because it gates on that in-memory-
 * only field. Existing callers that destructure only `{chatId}` are
 * unaffected by this extra field.
 *
 * `commsMode` (#743, additive): the founder's persisted comms-cadence
 * selection ('agile' default | 'pairProgramming'), so the dashboard's mode
 * selector can hydrate its current value on load instead of always showing
 * the default. Existing callers unaffected by this extra field.
 */

import { NextRequest } from 'next/server'
import { resolveAppVerified } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })
  const { entry, verified } = await resolveAppVerified(slug).catch(() => ({ entry: null, verified: false }))
  return Response.json({
    slug,
    chatId: entry?.chatId ?? null,
    idea: entry?.idea || null,
    commsMode: entry?.commsMode || 'agile',
    verified,
  })
}
