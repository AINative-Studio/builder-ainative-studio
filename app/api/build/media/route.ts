/**
 * /api/build/media (#54) — the company's auto-media routine + generated assets,
 * the machine surface for the MediaPanel on the Live dashboard AND for a founder's
 * own agent (AX, #54 req 5 — agent-triggerable).
 *
 * A media routine auto-generates ON-BRAND media (image or video) on a recurring
 * schedule (Once / Daily / Weekly / Monthly), mirroring Polsia's Auto Image /
 * Auto Video modals — but on primitives the company OWNS (core Multimodal +
 * Content-Workflow), with assets stored in the company's own ZeroDB (`build_media`),
 * scoped per {owner, company} exactly like the chat (#52), tasks (#55), versions
 * (#62) and documents (#64) stores. The owner half of the scope is ALWAYS taken
 * from the server session — never trusted from the body.
 *
 *   GET  ?companyId=…                       → { routines, assets, configured, nextRuns }
 *   POST { companyId, mediaKind, frequency, action: 'schedule' } → { routine, configured }
 *   POST { companyId, mediaKind, action: 'generate', brand? }    → { status, asset? }
 *
 * SAFETY (#54 req 6): when media generation is not configured (flag/key unset), the
 * endpoint stays live — scheduling still persists the founder's intent and generate
 * returns { status: 'disabled' } — so a missing key can never break build/runtime.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey, chatScopeKey } from '@/lib/build/chat-store'
import {
  saveRoutine,
  listMedia,
  runMediaGeneration,
  nextRunAt,
  mediaGenerationConfigured,
  normalizeMediaKind,
  normalizeFrequency,
  type BrandContext,
} from '@/lib/build/media-schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Resolve the durable media scope key from the SERVER session + company slug. */
async function resolveScopeKey(companyId: string): Promise<string> {
  const slug = String(companyId || '').trim()
  if (!slug) return ''
  const session = await auth().catch(() => null)
  return chatScopeKey(deriveOwnerKey(session as any), slug)
}

/**
 * GET — the company's media routines (latest per kind) + owned assets, the current
 * configured state, and the computed next-run per routine. Never 500s: on any
 * failure it yields empty collections so the dashboard still renders honestly.
 */
export async function GET(request: NextRequest) {
  const companyId = String(request.nextUrl.searchParams.get('companyId') || '').slice(0, 80)
  const scopeKey = await resolveScopeKey(companyId)
  const configured = mediaGenerationConfigured()
  if (!scopeKey) return Response.json({ routines: [], assets: [], configured, nextRuns: {} })

  const { routines, assets } = await listMedia(scopeKey).catch(() => ({ routines: [], assets: [] }))
  const nextRuns: Record<string, string | null> = {}
  for (const r of routines) nextRuns[r.mediaKind] = r.enabled ? nextRunAt(r.frequency, r.lastRunAt) : null

  return Response.json({ routines, assets, configured, nextRuns })
}

/**
 * POST — schedule a routine or trigger an immediate on-brand generation.
 *   action='schedule' → upsert the {mediaKind, frequency} routine (persists intent
 *                        even when generation is unconfigured).
 *   action='generate' → run one on-brand generation now (gated; 'disabled' when
 *                        unconfigured — never throws, never breaks runtime).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any))
  const companyId = String(body?.companyId || '').slice(0, 80)
  const scopeKey = await resolveScopeKey(companyId)
  if (!scopeKey) return Response.json({ error: 'missing_company' }, { status: 400 })

  const action = String(body?.action || 'schedule')
  const mediaKind = normalizeMediaKind(body?.mediaKind)

  if (action === 'generate') {
    const brand: BrandContext = {
      companyName: body?.brand?.companyName || body?.companyName,
      tagline: body?.brand?.tagline || body?.brandTagline,
      color: body?.brand?.color || body?.brandColor,
      idea: body?.brand?.idea || body?.idea,
    }
    const result = await runMediaGeneration(scopeKey, mediaKind, brand)
    return Response.json(result)
  }

  // Default: schedule / upsert a routine.
  const frequency = normalizeFrequency(body?.frequency)
  const enabled = body?.enabled !== false
  const routine = await saveRoutine(scopeKey, { mediaKind, frequency, enabled })
  if (!routine) return Response.json({ error: 'schedule_failed' }, { status: 502 })
  return Response.json({ routine, configured: mediaGenerationConfigured() })
}
