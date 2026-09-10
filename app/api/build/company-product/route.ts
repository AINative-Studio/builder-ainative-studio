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
 * Body: { idea, slug, name, designSystemId? }
 * Returns: { chatId, productSlug }
 */

import { NextRequest } from 'next/server'
import { registerApp, resolveApp } from '@/lib/build/app-registry'
import { logBuildOutcome } from '@/lib/build/learning'

export const runtime = 'nodejs'
export const maxDuration = 300

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
  if (existing?.chatId) return Response.json({ chatId: existing.chatId, productSlug, cached: true })

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

  try {
    const res = await fetch(`${base}/api/chat-ws`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, designSystemId }),
      signal: AbortSignal.timeout(280_000),
    })
    if (!res.body) return Response.json({ error: 'no stream' }, { status: 502 })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = '', chatId: string | null = null, sawRefresh = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const events = buf.split('\n\n'); buf = events.pop() || ''
      for (const ev of events) {
        const line = ev.split('\n').find((l) => l.startsWith('data:'))
        if (!line) continue
        let p: any; try { p = JSON.parse(line.slice(5).trim()) } catch { continue }
        if (p.type === 'init' && p.chatId) chatId = p.chatId
        if (p.type === 'refresh' || p.type === 'files') sawRefresh = true
      }
      if (chatId && sawRefresh) break
    }
    if (!chatId) return Response.json({ error: 'no chatId' }, { status: 502 })

    await registerApp({ slug: productSlug, chatId, name, track: 'company' })
    logBuildOutcome({
      slug: productSlug, idea, brand: name, track: 'company', chatId,
      codeStatus: sawRefresh ? 'success' : 'partial', converted: false,
    }).catch(() => {})
    return Response.json({ chatId, productSlug })
  } catch (e: any) {
    logBuildOutcome({ slug: productSlug, idea, brand: name, track: 'company', codeStatus: 'failure', converted: false }).catch(() => {})
    return Response.json({ error: 'generation_failed', detail: String(e?.message || e).slice(0, 120) }, { status: 502 })
  }
}
