/**
 * /api/build/comms-mode (#743) — founder-facing dashboard setting for Cody's
 * email comms cadence: 'agile' (default — a morning "yesterday / today /
 * blockers" standup) or 'pairProgramming' (a GitHub-style commit/PR digest
 * sourced from the company's Gitea repo). See lib/build/app-registry.ts's
 * commsMode field doc and app/api/cron/comms-digest/route.ts for the sender.
 *
 * POST { slug, mode } → { ok, mode? , reason? }
 *
 * Requires a REAL signed-in founder — same 401-for-anon/guest gate as
 * media/upload/route.ts (this is a durable company setting, not anonymous-
 * accessible). Validates `mode` is one of the two allowed values (400
 * otherwise). 404 when the company isn't registered.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { resolveApp, setAppCommsMode } from '@/lib/build/app-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_MODES = new Set(['agile', 'pairProgramming'])

export async function POST(request: NextRequest) {
  // Never anonymous/guest — this is a durable founder setting, matching
  // media/upload/route.ts's gate.
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  const type = (session as any)?.user?.type as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const slug = String(body?.slug || '').trim()
  const mode = String(body?.mode || '').trim()

  if (!slug) return Response.json({ error: 'missing_slug' }, { status: 400 })
  if (!VALID_MODES.has(mode)) {
    return Response.json({ error: 'invalid_mode', allowed: [...VALID_MODES] }, { status: 400 })
  }

  const app = await resolveApp(slug).catch(() => null)
  if (!app) return Response.json({ error: 'company_not_found' }, { status: 404 })

  const ok = await setAppCommsMode(slug, mode as 'agile' | 'pairProgramming')
  if (!ok) return Response.json({ ok: false, reason: 'write_failed' }, { status: 502 })

  return Response.json({ ok: true, mode })
}
