/**
 * Option B — enroll a company in the nightly autonomous loop (#207).
 * Called from the Live dashboard's "Hire the swarm" subscribe action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enrollCompany } from '@/lib/build/loop-enrollment'
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
    const ok = await enrollCompany({ companyId, companyName, track, goal })
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
