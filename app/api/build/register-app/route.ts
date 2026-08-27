/**
 * POST /api/build/register-app (#207 · FIX-2) — register a brand slug → generated
 * app chatId so /build/{slug} resolves to the real running app. GET ?slug= reads it.
 *
 * #213: on register, also resolve the persistent-deploy target (deployPersistent —
 * the SAME path the company track uses) and persist its URL on the registry entry, so
 * an APP-track generated app lands on a real, durable, shareable live URL — the
 * {slug}.ainative.studio wildcard host when configured, else the durable /build/{slug}
 * preview. The URL is returned so the app-track Preview can surface it immediately.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { registerApp, resolveApp } from '@/lib/build/app-registry'
import { deployPersistent } from '@/lib/build/deploy'
import { checkAppReady } from '@/lib/build/ready-gate'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  if (!b?.slug || !b?.chatId) return Response.json({ error: 'slug and chatId required' }, { status: 400 })
  const slug = String(b.slug).slice(0, 40)
  const chatId = String(b.chatId).slice(0, 64)

  // PRE-DEPLOY PARSE GATE (builder#77): before this slug is registered as ready +
  // deployed to its shareable URL, verify the generated app actually parses /
  // renders. A broken app (syntax error, hallucinated component, undefined ref)
  // must NOT be marked ready — the quad college-social-app shipped a Syntax-Error
  // page because there was no gate here. Fail-open only when the code can't be
  // found (store miss); BLOCK when we can prove it's broken, returning an honest
  // "generation failed, retrying" state so the client re-generates instead of
  // deploying a broken preview.
  // Store-miss RETRY (aerosol root cause, 2026-08-27): register can race the
  // durable persist — a store miss fail-opened and a truncated app got
  // registered while its code was still landing. Re-check up to 3× (2s apart)
  // before accepting an unverifiable app; genuine store outages still fail open.
  let ready = await checkAppReady(chatId).catch(() => ({ checked: false, ok: true } as const))
  for (let i = 0; !ready.checked && i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    ready = await checkAppReady(chatId).catch(() => ({ checked: false, ok: true } as const))
  }
  if (ready.checked && !ready.ok) {
    return Response.json(
      {
        ok: false,
        status: 'generation_failed',
        reason: ready.reason,
        error: ready.error,
        retry: true,
      },
      { status: 422 },
    )
  }

  // #213: resolve the durable live URL via the shared persistent-deploy seam and
  // persist it, so every generated app has a real shareable URL from registration.
  // Best-effort — a deploy-resolution hiccup must not block registration.
  let target: { url: string; dnsPointable: boolean } | null = null
  try {
    const t = await deployPersistent(chatId, slug)
    target = { url: t.url, dnsPointable: t.dnsPointable }
  } catch { /* fall back to no deployUrl; /build/{slug} still resolves */ }

  // The registry is append + latest-wins, so re-registering MUST carry the
  // existing entry forward — otherwise a fresh row would shadow provision-time
  // fields (zerodbProjectId, plan, domain, ownerEmail…) and silently orphan them.
  const existing = await resolveApp(slug).catch(() => null)

  // Ownership (#253 / Greg's missing-dashboard bug): stamp the signed-in
  // founder as owner AT REGISTRATION — provisioning/checkout may never run for a
  // free build, and an unowned entry is invisible to /api/build/my-companies.
  // Never overwrite a DIFFERENT existing owner (no stealing).
  let ownerEmail = existing?.ownerEmail || undefined
  try {
    const session = await auth()
    const email = ((session as any)?.user?.email as string | undefined)?.trim().toLowerCase()
    if (email) {
      const current = (existing?.ownerEmail || '').toLowerCase()
      if (!current || current === email) ownerEmail = email
    }
  } catch { /* anonymous or auth hiccup — register unowned as before */ }

  const ok = await registerApp({
    ...(existing || {}),
    slug,
    chatId,
    ownerEmail,
    name: b.name ? String(b.name).slice(0, 120) : existing?.name,
    tagline: b.tagline ? String(b.tagline).slice(0, 200) : existing?.tagline,
    color: b.color ? String(b.color).slice(0, 9) : existing?.color,
    track: b.track === 'company' ? 'company' : 'app',
    deployUrl: target?.url || existing?.deployUrl,
  })
  return Response.json({ ok, deployUrl: target?.url || null, dnsPointable: target?.dnsPointable ?? false })
}

export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get('slug') || ''
  const entry = await resolveApp(slug)
  return Response.json({ entry })
}
