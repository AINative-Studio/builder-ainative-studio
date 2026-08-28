/**
 * /api/build/committee-review (builder#346) — on-demand OFFLINE committee review
 * of a STORED generation.
 *
 * This is the measurement surface for the multi-model completeness committee. It
 * loads a generation by chatId, runs K independent frontier reviewers over it,
 * merges + agreement-counts their findings, and returns the report. It is NOT
 * wired into the live build path — you call it explicitly to measure whether
 * cross-model agreement predicts real defects before we ever gate on it.
 *
 *   GET  /api/build/committee-review?chatId=...[&focus=...][&models=a,b][&llmChair=1]
 *   POST { chatId, focus?, models?, useLlmChair? }
 *
 * Bounded + fail-open: the committee gate itself has a kill switch
 * (COMMITTEE_GATE_DISABLED=1 → inert non-blocking report), per-call timeouts, a
 * roster size cap, and a token cost cap; any failure degrades to a report rather
 * than a 500. This route never runs on the hot build path, so its cost is opt-in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { reviewGeneration, renderReport, type CommitteeOptions } from '@/lib/build/committee-gate'
import { runModelLive } from '@/lib/build/committee-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Frontier models on a big brief think a while; give the whole run room but stay
// bounded (the gate's per-call timeouts are the real guard).
export const maxDuration = 300

function parseModels(v: string | null | undefined): string[] | undefined {
  if (!v) return undefined
  const list = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

async function handle(chatId: string, opts: CommitteeOptions): Promise<NextResponse> {
  const id = (chatId || '').trim()
  if (!id) {
    return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
  }
  try {
    const report = await reviewGeneration(id, runModelLive, opts)
    return NextResponse.json({ report, markdown: renderReport(report) })
  } catch (e) {
    // Fail-open: an experiment endpoint must never 500 the caller.
    return NextResponse.json(
      {
        error: 'committee_review_failed',
        message: (e as Error)?.message || 'error',
        chatId: id,
      },
      { status: 200 },
    )
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams
  const chatId = sp.get('chatId') || sp.get('id') || ''
  const opts: CommitteeOptions = {
    focus: sp.get('focus') || undefined,
    models: parseModels(sp.get('models')),
    useLlmChair: sp.get('llmChair') === '1' || sp.get('useLlmChair') === '1',
  }
  return handle(chatId, opts)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    /* empty / invalid body → treated as no options */
  }
  const opts: CommitteeOptions = {
    focus: typeof body.focus === 'string' ? body.focus : undefined,
    models: Array.isArray(body.models) ? body.models : parseModels(body.models),
    useLlmChair: body.useLlmChair === true || body.useLlmChair === '1',
    chair: typeof body.chair === 'string' ? body.chair : undefined,
    maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
  }
  return handle(body.chatId || body.id || '', opts)
}
