/**
 * /api/build/deck (#69) — founder pitch-deck export (a PAID deliverable).
 *
 * Turns a company's already-generated artifacts (venture thesis, product roadmap,
 * mission, market research — the #64 Documents library / artifact system) into a
 * standard-VC, on-brand pitch deck (problem, solution, market, product, traction,
 * ask) and returns it as a real, EDITABLE PowerPoint file (.pptx). Optionally a
 * plain-text (.txt) rendering for a quick preview / no-Office fallback.
 *
 * Customer feedback (2026-08-24): "you've made your company, now go pitch it to
 * VCs — I'll export you a slick deck." That's the concrete "worth paying for"
 * deliverable this gates behind a paid plan.
 *
 * Endpoints (both agent-accessible — AX req 6):
 *   GET  ?companyId=…[&format=pptx|txt][&idea=…]   → streams the deck file
 *   POST { companyId, idea?, companyName?, tagline?, color?, format?, ask?[] }
 *                                                   → streams the deck file
 *
 * PAID GATE: the company's plan is read from the app-registry (entry.plan). No
 * paid plan → 402. This mirrors the other paid features (custom domain / nightly
 * loop) which key unlocks off the persisted plan. The gate can be bypassed only
 * in tests via DECK_DISABLE_PAYWALL (never set in prod).
 *
 * COMPOSITION: pure + tested in lib/build/deck-model.ts; serialization in
 * lib/build/deck-pptx.ts. This route is the I/O seam: it gathers the artifacts
 * (reading the durable library, generating any missing ones via the SAME Claude
 * completion stack the artifact/documents routes use), never fabricating content.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp } from '@/lib/build/app-registry'
import { documentScopeKey, listDocuments, getDocument } from '@/lib/build/document-store'
import { DOCUMENT_PROMPTS, type DocGenContext } from '@/lib/build/document-prompts'
import { completeText } from '@/lib/build/claude-completion'
import { buildDeckModel, deckToText, type DeckArtifacts, type DeckBrand } from '@/lib/build/deck-model'
import { deckToPptx, deckFileName } from '@/lib/build/deck-pptx'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Plans that unlock the paid pitch-deck export. Any paid tier qualifies. */
const PAID_PLANS = new Set(['pro', 'business', 'enterprise', 'cody_vcto'])

/** Is this company on a paid plan (per the persisted app-registry entry)? */
function isPaid(plan: string | undefined): boolean {
  if (process.env.DECK_DISABLE_PAYWALL === '1') return true
  return PAID_PLANS.has(String(plan || '').toLowerCase().trim())
}

/** Resolve the durable documents scope key from the SERVER session + company slug. */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return documentScopeKey(session as any, slug)
}

/**
 * Gather the four artifacts a deck is composed from out of the company's durable
 * Documents library (#64). Returns whatever exists — missing types are filled by
 * generateMissing() next. Never throws (degrades to {}).
 */
async function gatherArtifacts(scopeKey: string): Promise<DeckArtifacts> {
  const out: DeckArtifacts = {}
  if (!scopeKey) return out
  try {
    const summaries = await listDocuments(scopeKey)
    // Latest doc per type wins (listDocuments returns newest-first).
    const byType = new Map<string, string>()
    for (const s of summaries) {
      if (s.kind !== 'document' || byType.has(s.type)) continue
      byType.set(s.type, s.id)
    }
    const load = async (type: string): Promise<string | undefined> => {
      const id = byType.get(type)
      if (!id) return undefined
      const doc = await getDocument(scopeKey, id).catch(() => null)
      return doc?.content || undefined
    }
    const [mission, roadmap, market, research] = await Promise.all([
      load('mission'),
      load('roadmap'),
      load('market'),
      load('research'),
    ])
    if (mission) out.mission = mission
    if (roadmap) out.roadmap = roadmap
    if (market) out.market = market
    if (research) out.research = research
  } catch {
    /* degrade to whatever we have */
  }
  return out
}

/**
 * Generate any missing core artifact (mission, roadmap, market) via the shared
 * Claude stack, using the SAME #64 document prompts — so the deck can be produced
 * even for a company that has not clicked "generate" on every doc yet. Best-effort:
 * a generation failure just leaves that section as an honest placeholder.
 */
async function generateMissing(artifacts: DeckArtifacts, ctx: DocGenContext): Promise<DeckArtifacts> {
  const need: ('mission' | 'roadmap' | 'market')[] = []
  if (!artifacts.mission) need.push('mission')
  if (!artifacts.roadmap) need.push('roadmap')
  if (!artifacts.market) need.push('market')
  if (!need.length) return artifacts

  await Promise.all(
    need.map(async (type) => {
      const spec = DOCUMENT_PROMPTS[type]
      if (!spec) return
      try {
        const { text } = await completeText({
          system: spec.system,
          user: spec.user(ctx),
          maxTokens: 1400,
          temperature: 0.5,
        })
        if (text && text.trim().length > 40) artifacts[type] = text.trim()
      } catch (e: any) {
        logger.warn?.('[build/deck] artifact generation failed', { type, err: e?.message?.slice(0, 80) })
      }
    }),
  )
  return artifacts
}

/**
 * Core handler shared by GET/POST: gate → gather → compose → serialize → stream.
 * `input` carries the parsed request fields.
 */
async function handle(input: {
  companyId: string
  idea?: string
  companyName?: string
  tagline?: string
  color?: string
  format?: string
  ask?: string[]
  track?: 'app' | 'company'
}): Promise<Response> {
  const companyId = String(input.companyId || '').slice(0, 80).trim()
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })

  // PAID GATE — read the company's plan from the persisted registry.
  const entry = await resolveApp(companyId).catch(() => null)
  if (!isPaid(entry?.plan)) {
    return Response.json(
      { error: 'payment_required', reason: 'The pitch-deck export is a paid deliverable. Upgrade to export.' },
      { status: 402 },
    )
  }

  const scopeKey = await resolveScopeKey(companyId)

  // Brand — prefer explicit body/query, fall back to the registry entry.
  const brand: DeckBrand = {
    name: (input.companyName || entry?.name || companyId).slice(0, 120),
    tagline: (input.tagline || entry?.tagline || '').slice(0, 200) || undefined,
    color: input.color || entry?.color,
  }
  const idea = String(input.idea || '').slice(0, 4000)

  // Gather the artifacts; generate the missing core ones so the deck is complete.
  let artifacts = await gatherArtifacts(scopeKey)
  artifacts.idea = idea || artifacts.idea
  if (idea) {
    artifacts = await generateMissing(artifacts, {
      idea,
      companyName: brand.name,
      track: input.track === 'company' ? 'company' : 'app',
    })
  }

  const model = buildDeckModel(artifacts, brand, {
    ask: input.ask && input.ask.length ? input.ask : undefined,
  })

  const format = (input.format || 'pptx').toLowerCase()
  const safeName = deckFileName(brand.name, format === 'txt' ? 'txt' : 'pptx')

  if (format === 'txt') {
    return new Response(deckToText(model), {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'X-Deck-Filled-Sections': String(model.filledSections),
        'X-Deck-Total-Sections': String(model.totalSections),
      },
    })
  }

  try {
    const bytes = await deckToPptx(model)
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(bytes.length),
        'X-Deck-Filled-Sections': String(model.filledSections),
        'X-Deck-Total-Sections': String(model.totalSections),
      },
    })
  } catch (e) {
    logger.error?.('[build/deck] pptx serialization failed', e as Error)
    return Response.json({ error: 'export_failed' }, { status: 502 })
  }
}

/** GET — agent-accessible export (AX). Reads params from the query string. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  return handle({
    companyId: p.get('companyId') || p.get('chatId') || '',
    idea: p.get('idea') || undefined,
    companyName: p.get('companyName') || undefined,
    tagline: p.get('tagline') || undefined,
    color: p.get('color') || undefined,
    format: p.get('format') || undefined,
    track: (p.get('track') as 'app' | 'company') || undefined,
  })
}

/** POST — the export action fired from the Live / Documents surface. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  return handle({
    companyId: body.companyId || body.chatId || '',
    idea: body.idea,
    companyName: body.companyName,
    tagline: body.tagline,
    color: body.color,
    format: body.format,
    ask: Array.isArray(body.ask) ? body.ask.map((a: unknown) => String(a)) : undefined,
    track: body.track,
  })
}
