/**
 * POST /api/build/company-product (issue #620) — generate the founder's REAL,
 * FUNCTIONAL product for a Company-track build, distinct from the marketing
 * landing page /api/build/company-app already builds.
 *
 * Real gap (customer-reported, Meridian, 2026-09-10): the Company track's
 * ONE real generated app was always a landing page (hero/features/pricing/
 * footer) — nothing a founder built there ever did what their idea actually
 * describes. Meridian's idea is "a personalized business advisor that
 * analyzes... sales pipeline data... to forecast revenue" — its landing page
 * looked right but contained zero code that called ZeroPipeline or did any
 * forecasting. The "product" never existed, only its marketing page did.
 *
 * This route builds that missing product: it calls the SAME real codegen
 * engine (/api/chat-ws) the App track already uses for genuinely functional
 * apps, with a prompt that asks for the founder's idea AS A WORKING TOOL —
 * not a landing page — and, critically, WITHOUT landingPageOnly, so
 * checkObedience's primitive-compliance check stays fully enforced: if the
 * idea matches ZeroPipeline (like Meridian's does), the generated code must
 * actually call it, not just describe it in marketing copy.
 *
 * Registered under a slug DISTINCT from the landing page's own slug (the
 * `-product` suffix) so the two never collide in app-registry, and served
 * at /build/{slug}-product independently of /build/{slug}'s landing page.
 * Idempotent-ish: if that slug already resolves, returns the existing chatId.
 *
 * Real bug found live (issue #629/#631/#633, 2026-09-10): this route used to
 * hold the HTTP request open, synchronously consuming chat-ws's SSE stream
 * until 'complete' before responding. A real generation that needs the
 * primitive-compliance retry (#624-#627) can legitimately run past 300s once
 * that extra repair round-trip is included — and Railway's edge proxy sits
 * in FRONT of this container with its own hard request timeout that no
 * amount of raising this route's own maxDuration/AbortSignal can control
 * (confirmed live: a real Meridian generation that had genuinely SUCCEEDED
 * server-side — obedience-repair adopted, ZeroDB persist confirmed, real
 * /api/primitive/zeropipeline + /api/primitive/zerovoice calls in the saved
 * code — still came back to the caller as a 502 "upstream error" at exactly
 * the 300s mark). Holding one HTTP connection open for a job whose real
 * duration this route doesn't control is the wrong shape for this platform.
 *
 * Now decoupled: this route kicks off the chat-ws generation as a DETACHED
 * background task (this container is a persistent Railway service, not
 * serverless — an unawaited async task keeps running after the response is
 * sent, as long as the process itself stays up) and returns immediately with
 * { status: 'processing', productSlug }. The caller polls
 * GET /api/build/resolve-app?slug={productSlug} until it resolves a chatId.
 *
 * REGISTRATION DURABILITY (issue #660 follow-up, found live investigating why
 * a real account's 20 companies never got a working product despite this
 * generation genuinely succeeding, repeatedly): chat-ws's own saveGeneration()
 * call is awaited BEFORE it emits 'complete' — so a generated app's code is
 * durably persisted in the `generations` table the moment this route's reader
 * loop even sees a chatId, well before the loop would go on to observe
 * 'complete' and call registerApp(). But a Railway redeploy kills this
 * detached task's container mid-loop, ANY time after 'init' — meaning the
 * expensive, already-succeeded generation can be silently orphaned: real
 * code sitting in `generations`, never linked to productSlug, so
 * /build/{productSlug} 404s forever and a fresh POST here would otherwise
 * regenerate from scratch. Confirmed live: exactly this happened to a real
 * Dispatch product generation.
 *
 * Fixed by writing a durable {productSlug -> chatId} pending record the
 * MOMENT chatId is known (lib/build/product-generation-state.ts), and, on
 * every POST, checking for a prior pending attempt FIRST: if its generation
 * is already sitting complete in `generations`, finish registration
 * immediately instead of paying for a new generation.
 *
 * Body: { idea, slug, name, designSystemId? }
 * Returns: { status: 'processing' | 'cached' | 'recovered', productSlug, chatId? }
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

export const runtime = 'nodejs'

async function runProductGeneration(
  base: string, message: string, designSystemId: string | undefined,
  productSlug: string, idea: string, name: string,
): Promise<void> {
  try {
    const res = await fetch(`${base}/api/chat-ws`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, designSystemId }),
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
          // Write the durable link as soon as chatId is known — NOT awaited
          // in the hot loop's control flow beyond this one call, so a
          // container death anywhere after this point is recoverable on the
          // next request for this productSlug (see doc comment above).
          if (!recordedPending) {
            recordedPending = true
            void recordPendingProductGeneration(productSlug, p.chatId)
          }
        }
        // Wait for 'complete' (both chat-ws's degraded and success paths
        // emit it), not the first 'refresh'/'files' — those fire repeatedly
        // during mid-generation streaming, well before obedience-repair /
        // closePrimitiveComplianceGap and the final ZeroDB persist run.
        if (p.type === 'complete') completed = true
      }
      if (chatId && completed) break
    }
    if (!chatId) throw new Error('no chatId')

    await registerApp({ slug: productSlug, chatId, name, track: 'company', idea })
    await markProductGenerationRegistered(productSlug, chatId)
    logBuildOutcome({
      slug: productSlug, idea, brand: name, track: 'company', chatId,
      codeStatus: completed ? 'success' : 'partial', converted: false,
    }).catch(() => {})
  } catch (e: any) {
    logBuildOutcome({ slug: productSlug, idea, brand: name, track: 'company', codeStatus: 'failure', converted: false }).catch(() => {})
    console.warn(`[company-product] background generation failed for ${productSlug}:`, e?.message || e)
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null)
  const idea = String(b?.idea || '').trim().slice(0, 3000)
  const slug = String(b?.slug || '').slice(0, 40)
  if (!idea || !slug) return Response.json({ error: 'idea and slug required' }, { status: 400 })

  // Distinct slug from the landing page's own — never collides in
  // app-registry, and gives the product its own durable /build/{slug} entry.
  const productSlug = `${slug}-product`.slice(0, 40)

  // Already built? return the existing chatId (don't regenerate).
  const existing = await resolveApp(productSlug).catch(() => null)
  if (existing?.chatId) return Response.json({ chatId: existing.chatId, productSlug, status: 'cached' })

  // Recover an orphaned prior attempt (registration-durability gap, #660):
  // a previous call's background task may have gotten a chatId, had its
  // generation genuinely succeed and persist, and then died (e.g. a deploy)
  // before ever calling registerApp. Check for that BEFORE starting a brand
  // new, costly generation.
  const pending = await resolvePendingProductGeneration(productSlug).catch(() => null)
  if (pending?.chatId && pending.status === 'pending') {
    const gen = await loadGeneration(pending.chatId).catch(() => null)
    if (gen?.generatedCode) {
      const name = String(b?.name || slug).slice(0, 120)
      const registered = await registerApp({ slug: productSlug, chatId: pending.chatId, name, track: 'company', idea })
      if (registered) {
        await markProductGenerationRegistered(productSlug, pending.chatId)
        return Response.json({ chatId: pending.chatId, productSlug, status: 'recovered' })
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
      return Response.json({ status: 'processing', productSlug })
    }
  }

  const name = String(b?.name || slug).slice(0, 120)
  const designSystemId = typeof b?.designSystemId === 'string' ? b.designSystemId.slice(0, 40) : undefined

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  // Deliberately asks for a REAL, working tool — not marketing copy. No
  // landingPageOnly flag here (see company-app/route.ts's sibling comment):
  // this generation SHOULD be held to full primitive-compliance, because a
  // real product genuinely should call the primitives its idea implies.
  // Real bug (customer-reported, Meridian, 2026-09-10, issue #611/#615/#620):
  // this template's FIRST draft said "the ACTUAL PRODUCT" — the whole word
  // 'product' — which lib/prd-parser.ts's keyword detector (fixed for a
  // DIFFERENT false match in #615, "production-quality"→'product') correctly
  // still catches, because this time 'product' is genuinely, literally
  // present as a standalone word, not a substring-of-another-word false
  // positive. That triggered a real, live "Products Page (/products)" build
  // step + a 2-page complexity score for a plain single-surface generation
  // (confirmed live: exact same failure signature as #615, from THIS
  // route's own wording this time). This template avoids the words 'product'
  // and 'match'/'matching' (the two-sided-marketplace primitive's own
  // trigger, which "primitives that best match this idea" would otherwise
  // hit) entirely, describing the same intent without either.
  const message =
    `Build a real, working, functional application for "${name}" that actually implements this idea: ${idea}. ` +
    `This is the founder's REAL, WORKING TOOL — not a marketing page — build the core feature(s) a user would ` +
    `use every day: real data, real interactions, real functionality that does what the idea describes. ` +
    `Compose whichever AINative primitives genuinely fit this specific idea (persistence, memory, pipeline, ` +
    `commerce, voice, etc.) and call their real APIs, not a hand-rolled substitute. ` +
    `Make it visually distinctive and specific to this company, with realistic data — not a generic template.`

  // Detached: NOT awaited. This container is a persistent Railway service
  // (not serverless), so this keeps running after the response below is
  // sent, bounded only by its own AbortSignal.timeout — decoupling this
  // route's response time from the real, unpredictable generation duration.
  void runProductGeneration(base, message, designSystemId, productSlug, idea, name)

  return Response.json({ status: 'processing', productSlug })
}
