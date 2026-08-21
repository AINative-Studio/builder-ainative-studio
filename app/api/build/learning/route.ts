/**
 * GET /api/build/learning (#270) — recursive-loop learning rollup.
 *
 * Returns the aggregate signal the nightly recursive briefing / RLHF loop consumes
 * to LEARN from every /build company flow: total builds, conversion rate, codegen
 * failure rate, per-track split, and the recent NON-CONVERTER ideas (the ones Cody
 * must learn from). Reads the durable builder_learning table (see lib/build/learning.ts).
 *
 * Gating (no raw PII leaks):
 *  - Public / unauthenticated → aggregate counts ONLY (rates + totals). No idea text.
 *  - Server-key authed (Authorization: Bearer $CRON_SECRET, same as the nightly
 *    loop cron) → full rollup INCLUDING the recent non-converter idea list, so the
 *    loop can brief on them. The idea text is the founder's own build prompt; brand
 *    is the public product name — no user email / account PII is ever stored or returned.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readLearningRows, rollup } from '@/lib/build/learning'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const authed = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  try {
    const rows = await readLearningRows()
    const limit = Math.min(Number(new URL(request.url).searchParams.get('limit')) || 50, 200)
    const r = rollup(rows, limit)

    // Aggregate-only public view: strip the raw idea list unless server-key authed.
    const body = {
      totalBuilds: r.totalBuilds,
      converted: r.converted,
      conversionRate: Number(r.conversionRate.toFixed(4)),
      codegenFailureRate: Number(r.codegenFailureRate.toFixed(4)),
      byTrack: r.byTrack,
      nonConverterCount: r.nonConverterIdeas.length,
      nonConverterIdeas: authed ? r.nonConverterIdeas : undefined,
      updatedAt: r.updatedAt,
    }
    return NextResponse.json(body)
  } catch (error) {
    return NextResponse.json({ error: 'learning_rollup_failed' }, { status: 500 })
  }
}
