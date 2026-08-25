/**
 * POST /api/build/migrate (#49) — guest → real-account migration.
 *
 * When an anonymous guest builds a company and THEN registers or logs in, their
 * in-progress work must survive the transition. The client posts the company
 * slug(s) it has in-progress (from build state / localStorage); this stamps the
 * NOW-authenticated founder's email as the owner of those companies (via
 * migrateGuestCompanies), so they surface in the "my companies" index under the
 * real account and are never lost.
 *
 * SECURITY: the owner email is taken from the SERVER-verified session only — the
 * request body carries slugs, NEVER an email. Anonymous (no session, or a guest
 * session) → 401, since there is no real account to migrate work into. Only
 * UNOWNED companies are claimed; a company already owned by someone else is
 * skipped, never stolen (see migrateGuestCompanies).
 *
 * Body: { slugs: string[] }   (single { slug } is also accepted)
 * Returns: { ok, migrated: string[], skipped: string[] } | { ok:false, error }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { migrateGuestCompanies } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

// Cap the batch so a malformed/hostile body can't fan out into an unbounded
// number of registry reads. A founder realistically has a handful in flight.
const MAX_SLUGS = 25

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const email = (session as any)?.user?.email as string | undefined
  const type = (session as any)?.user?.type as string | undefined

  // Must be a REAL account — a guest session has nothing durable to migrate into.
  if (!email || type === 'guest') {
    return Response.json({ ok: false, error: 'not_signed_in' }, { status: 401 })
  }

  const b = await request.json().catch(() => null)
  const raw: unknown[] = Array.isArray(b?.slugs)
    ? b.slugs
    : b?.slug != null
      ? [b.slug]
      : []
  const slugs = raw
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, MAX_SLUGS)

  if (slugs.length === 0) {
    return Response.json({ ok: true, migrated: [], skipped: [] })
  }

  const { migrated, skipped } = await migrateGuestCompanies(slugs, email).catch(
    () => ({ migrated: [] as string[], skipped: slugs }),
  )

  return Response.json({ ok: true, migrated, skipped })
}
