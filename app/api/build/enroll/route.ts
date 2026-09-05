/**
 * Option B — enroll a company in the nightly autonomous loop (#207).
 * Called from the Live dashboard's "Hire the swarm" subscribe action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enrollCompany, isEnrolled } from '@/lib/build/loop-enrollment'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { companyId, companyName, track, goal } = body
    if (!companyId || !companyName || !track) {
      return NextResponse.json({ error: 'companyId, companyName, and track are required' }, { status: 400 })
    }
    // Capture the owner key from the SERVER session so the nightly loop can append
    // the daily operational report (#64) to the same {owner, company} document scope.
    const session = await auth().catch(() => null)
    const ownerKey = deriveOwnerKey(session as any)
    // De-dup guard (real bug: a founder clicking "Hire the swarm" more than once —
    // a re-render, a double-click, a retried request after a slow response — used
    // to append ANOTHER enabled enrollment row every time, because enrollCompany()
    // itself has no dedup (it's an append-only store). listEnrolled() then returned
    // this company once PER duplicate row, so the nightly-loop's `for (const e of
    // enrolled)` loop ran the ENTIRE per-company pipeline (swarm dispatch, daily
    // report append, media routine) once per duplicate — producing the exact
    // "same daily report repeated N times" bug seen live. register-app and
    // subscription/verify already guard enrollCompany() with isEnrolled() first;
    // this route (the direct "Hire the swarm" action) was the one path that didn't.
    if (await isEnrolled(companyId)) {
      return NextResponse.json({ ok: true, alreadyEnrolled: true })
    }
    const ok = await enrollCompany({ companyId, companyName, track, goal, ownerKey })
    if (!ok) {
      return NextResponse.json({ ok: false, detail: 'enrollment store not configured or write failed' }, { status: 200 })
    }
    logger.info('Company enrolled in nightly loop', { companyId, track })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Loop enrollment failed', error as Error)
    return NextResponse.json({ error: 'Enrollment failed' }, { status: 500 })
  }
}
