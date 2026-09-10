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
 */

import { NextRequest } from 'next/server'
import { resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })
  const entry = await resolveApp(slug).catch(() => null)
  return Response.json({ slug, chatId: entry?.chatId ?? null })
}
