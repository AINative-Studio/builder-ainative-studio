/**
 * POST /api/build/company-app (#207 · FIX-2) — generate a REAL landing-page app
 * for a Company-track build (which otherwise has no running app), then register
 * slug → chatId so /build/{slug} shows it.
 *
 * The company track produces a business (thesis, wedge, pricing, landing copy)
 * but no deployed product — so its "prod URL" pointed at nothing. This builds a
 * real, idea-specific landing page via the same codegen pipeline used for apps,
 * and returns the chatId. Idempotent-ish: if the slug already resolves, returns it.
 *
 * Real gap (customer-reported, Meridian, 2026-09-10): this route never forwarded
 * a chosen design system to chat-ws at all, so the ONE real generated app the
 * Company track produces always fell back to plain Inter/Poppins/#5867EF
 * regardless of what the founder picked — the Company track previously had no
 * Design step to pick from in the first place (see lib/build/state.ts's
 * PICK_TRACK), so there was nothing to forward. Now accepts designSystemId and
 * passes it straight through, same as the App track's chat-ws calls.
 *
 * REGISTRATION NEVER HAPPENING (found live, 2026-09-13, verifying Cody composes
 * AINative primitives correctly): this route used to hold the HTTP request
 * open, synchronously consuming chat-ws's SSE stream until chatId+refresh
 * before responding, bounded by its own 280s AbortSignal.timeout. Once the
 * cody-cli agent became the primary generation path (CODY_AGENT_PRIMARY=1),
 * a real generation routinely spends its own 240s wall-clock limit on a
 * failing agent attempt (#350) BEFORE falling back to Bedrock — pushing the
 * real end-to-end duration past this route's 280s abort. Confirmed live: many
 * real, successful generations (verified via the showcase entries chat-ws's
 * OWN persist path creates, independent of this route surviving) NEVER
 * produced a builder_app_registry row — the abort fired before chatId+refresh
 * was ever observed, so registerApp() was never reached, even though the
 * generation itself succeeded. This is the exact same bug class
 * company-product/route.ts documents fixing (its own doc comment: "Railway's
 * edge proxy... has its own hard request timeout that no amount of raising
 * this route's own maxDuration/AbortSignal can control") — that route was
 * fixed; this one, its older sibling, never was.
 *
 * Fixed the same way: kick off generation as a DETACHED background task (this
 * container is a persistent Railway service, not serverless — an unawaited
 * async task keeps running after the response is sent) and return
 * immediately with { status: 'processing' }. The caller polls
 * GET /api/build/resolve-app?slug={slug} until it resolves a chatId — see
 * components/build/screens/Live.tsx's existing company-product poll loop,
 * mirrored here for company-app. Reuses lib/build/product-generation-state.ts
 * as-is (it's genuinely generic — keyed on a plain slug/chatId pair, nothing
 * product-specific) for the same registration-durability guarantee across a
 * mid-generation redeploy.
 *
 * Body: { idea, slug, name, tagline, color, designSystemId? }
 * Returns: { status: 'processing' } | { chatId, cached: true } | { chatId, status: 'recovered' }
 */

import { NextRequest } from 'next/server'
import { registerApp, resolveApp } from '@/lib/build/app-registry'
import { logBuildOutcome } from '@/lib/build/learning'
import {
  recordPendingProductGeneration,
  markProductGenerationRegistered,
  resolvePendingProductGeneration,
} from '@/lib/build/product-generation-state'
import { loadGeneration } from '@/lib/zerodb-store'
import { reportDeploymentHealthStage } from '@/lib/build/deployment-health'

export const runtime = 'nodejs'

async function runLandingPageGeneration(
  base: string, message: string, designSystemId: string | undefined,
  slug: string, idea: string, name: string, tagline: string, color: string,
): Promise<void> {
  try {
    const res = await fetch(`${base}/api/chat-ws`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // #612 (Meridian, 2026-09-10): this route ONLY ever builds marketing
      // copy (hero/features/pricing/footer) — never the real product — so it
      // has no legitimate reason to call any primitive's live API, even when
      // `idea` (embedded in `message` above) happens to match one's trigger
      // keywords. Tells chat-ws to skip primitive-compliance re-prompting for
      // this specific generation; every other obedience check still applies.
      body: JSON.stringify({ message, designSystemId, landingPageOnly: true }),
      signal: AbortSignal.timeout(780_000),
    })
    if (!res.body) throw new Error('no stream')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', chatId: string | null = null, completed = false, recordedPending = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split('\n\n'); buf = events.pop() || ''
      for (const ev of events) {
        const line = ev.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let p: any; try { p = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (p.type === 'init' && p.chatId) {
          chatId = p.chatId
          // Write the durable link as soon as chatId is known — same
          // registration-durability guarantee as company-product/route.ts:
          // a container death anywhere after this point is recoverable on
          // the next request for this slug.
          if (!recordedPending) {
            recordedPending = true
            void recordPendingProductGeneration(slug, p.chatId)
          }
        }
        // Wait for 'complete' (both chat-ws's degraded and success paths
        // emit it), not the first 'refresh'/'files' — those fire repeatedly
        // during mid-generation streaming, well before the final ZeroDB persist.
        if (p.type === 'complete') completed = true
      }
      if (chatId && completed) break
    }
    if (!chatId) throw new Error('no chatId')
    await reportDeploymentHealthStage(
      'builder_app_generation', slug, 'generate',
      completed ? 'ok' : 'failed',
      completed ? undefined : 'Stream ended without a complete event.',
    )

    const registered = await registerApp({ slug, chatId, name, tagline, color, track: 'company', idea })
    await reportDeploymentHealthStage('builder_app_generation', slug, 'register', registered ? 'ok' : 'failed')
    await markProductGenerationRegistered(slug, chatId)
    // #270: capture the IDEA → generated app for the recursive learning loop, with
    // converted:false initially. subscription/verify flips it converted on payment.
    // Fire-and-forget — must never slow or fail the build request path.
    logBuildOutcome({
      slug, idea, brand: name, track: 'company', chatId,
      codeStatus: completed ? 'success' : 'partial', converted: false,
    }).catch(() => {})
  } catch (e: any) {
    logBuildOutcome({ slug, idea, brand: name, track: 'company', codeStatus: 'failure', converted: false }).catch(() => {})
    await reportDeploymentHealthStage('builder_app_generation', slug, 'generate', 'failed', e?.message ? String(e.message) : 'Landing-page generation threw an error.')
    console.warn(`[company-app] background generation failed for ${slug}:`, e?.message || e)
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const idea = String(b?.idea || '').trim().slice(0, 3000)
  const slug = String(b?.slug || '').slice(0, 40)
  if (!idea || !slug) return Response.json({ error: 'idea and slug required' }, { status: 400 })
  // Real gap (same as company-product/route.ts's own force param): a
  // generation that registered a chatId but whose CODE failed server-side
  // validation serves a real, honest error page with a real Regenerate
  // button — that button had nowhere to force a fresh attempt, since this
  // cache check always short-circuited back to the SAME broken chatId.
  const force = b?.force === true

  // Already built? return the existing chatId (don't regenerate) — unless
  // the caller explicitly asked to force a fresh attempt (see above).
  const existing = await resolveApp(slug).catch(() => null)
  if (existing?.chatId && !force) return Response.json({ chatId: existing.chatId, cached: true })

  // Recover an orphaned prior attempt (same registration-durability gap
  // company-product/route.ts closed, #660 follow-up): a previous call's
  // background task may have gotten a chatId, had its generation genuinely
  // succeed and persist, and then died (e.g. a deploy) before ever calling
  // registerApp. Check for that BEFORE starting a brand new, costly generation.
  const pending = await resolvePendingProductGeneration(slug).catch(() => null)
  if (pending?.chatId && pending.status === 'pending') {
    const gen = await loadGeneration(pending.chatId).catch(() => null)
    if (gen?.generatedCode) {
      const name = String(b?.name || slug).slice(0, 120)
      const tagline = String(b?.tagline || '').slice(0, 200)
      const color = /^#[0-9a-fA-F]{6}$/.test(String(b?.color || '')) ? String(b.color) : '#2f6d86'
      const registered = await registerApp({ slug, chatId: pending.chatId, name, tagline, color, track: 'company', idea })
      if (registered) {
        await markProductGenerationRegistered(slug, pending.chatId)
        return Response.json({ chatId: pending.chatId, status: 'recovered' })
      }
    }
    // Generation not actually done yet. Two possibilities: it's still
    // genuinely in-flight on this or another live process (chat-ws's own
    // AbortSignal.timeout is 780s), or the process that recorded this
    // pending attempt died before chat-ws itself ever finished/persisted —
    // truly orphaned, not just slow. Give the real in-flight case its full
    // window; only past it treat the attempt as dead and fall through to
    // start a genuinely fresh generation (never poll forever with no exit).
    const ageMs = Date.now() - new Date(pending.createdAt).getTime()
    const STILL_PLAUSIBLY_RUNNING_MS = 780_000 + 60_000
    if (!gen?.generatedCode && ageMs < STILL_PLAUSIBLY_RUNNING_MS) {
      return Response.json({ status: 'processing' })
    }
  }

  const name = String(b?.name || slug).slice(0, 120)
  const tagline = String(b?.tagline || '').slice(0, 200)
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b?.color || '')) ? String(b.color) : '#2f6d86'
  const designSystemId = typeof b?.designSystemId === 'string' ? b.designSystemId.slice(0, 40) : undefined

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  // Real bug (customer-reported, Meridian, 2026-09-10): this exact template
  // used to say "primary BRAND color" — 'brand' was (wrongly) a ZeroCommerce
  // trigger word in lib/build/primitive-catalog.ts, so EVERY Company-track
  // landing page falsely matched ecommerce and got steered toward building
  // an unrelated storefront instead of the requested page (confirmed
  // reproducible 4/4 attempts; the 'brand' trigger itself was removed as the
  // primary fix, but rewording here too so this template stops relying on a
  // word that happened to collide with primitive-selection vocabulary).
  // "single-page marketing LANDING PAGE" also technically matches Content
  // Workflow's 'marketing' trigger — lower-severity (a much closer-fit
  // primitive than ZeroCommerce was), left as "marketing" since that's an
  // accurate, load-bearing description of what's being built, not swapped
  // out reflexively.
  const message =
    `Build a polished, production-quality single-page marketing LANDING PAGE for "${name}"` +
    (tagline ? ` (tagline: "${tagline}")` : '') +
    ` — a real company for this idea: ${idea}. ` +
    `Include: a hero with the value prop and a "Get early access" CTA, a 3-feature section, ` +
    `a how-it-works section, pricing (3 tiers), and a footer. Use ${color} as the main accent color. ` +
    `Make it visually distinctive and specific to this company, with realistic copy — not a generic template.`

  // Detached: NOT awaited. This container is a persistent Railway service
  // (not serverless), so this keeps running after the response below is
  // sent, bounded only by its own AbortSignal.timeout — decoupling this
  // route's response time from the real, unpredictable generation duration
  // (which can now legitimately exceed the cody-cli agent's own 240s
  // timeout before it falls back to Bedrock).
  void runLandingPageGeneration(base, message, designSystemId, slug, idea, name, tagline, color)

  return Response.json({ status: 'processing' })
}
