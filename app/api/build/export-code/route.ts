/**
 * /api/build/export-code (#1187) — download YOUR company's real, working
 * project as a ZIP. Distinct from /api/build/export (#63.C), which exports
 * the company's ZeroDB DATA — this exports the actual generated APP CODE,
 * the same multi-file source the live preview runs (see lib/build/
 * project-export.ts for the full rationale and prior-state writeup).
 *
 * Auth: a REAL (non-guest) session that OWNS the company — same owner-only
 * guard as /api/build/export.
 *
 *   GET ?companyId=…   → ZIP file download (Content-Disposition: attachment)
 *   POST { companyId } → same (for agent/programmatic callers)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { resolveApp, type AppEntry } from '@/lib/build/app-registry'
import { resolveStoredApp } from '@/lib/build/ready-gate'
import { buildProjectZip, projectExportFileName } from '@/lib/build/project-export'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Owner-only resolution shared by GET + POST. Returns the entry or a short-circuit Response. */
async function authorizeCompany(session: unknown, companyId: string): Promise<AppEntry | Response> {
  const type = (session as any)?.user?.type as string | undefined
  const email = (session as any)?.user?.email as string | undefined
  if (!email || type === 'guest') {
    return Response.json({ error: 'not_signed_in' }, { status: 401 })
  }
  if (!companyId) return Response.json({ error: 'companyId required' }, { status: 400 })

  const entry = await resolveApp(companyId).catch(() => null)
  if (!entry) return Response.json({ error: 'company not found' }, { status: 404 })

  const owner = deriveOwnerKey(session as any)
  if (!entry.ownerEmail || entry.ownerEmail.trim().toLowerCase() !== owner) {
    return Response.json({ error: 'not_owner' }, { status: 403 })
  }
  return entry
}

/** Build the project export and return it as an attachment download, or a JSON error. */
async function respondWithExport(entry: AppEntry, companyId: string): Promise<Response> {
  if (!entry.chatId) {
    return Response.json({ error: 'this company has no generated app to export yet' }, { status: 400 })
  }

  const stored = await resolveStoredApp(entry.chatId).catch(() => null)
  if (!stored?.code) {
    return Response.json({ error: 'no generated code found for this company yet' }, { status: 404 })
  }

  const result = await buildProjectZip(stored, {
    name: entry.name || entry.slug || companyId,
    slug: entry.slug || companyId,
    tagline: entry.tagline,
    domain: entry.domain,
  })

  const filename = projectExportFileName(entry.slug || companyId)
  logger.info('project source exported', {
    companyId,
    multiFile: result.multiFile,
    fileCount: result.generatedFileCount,
  })

  return new Response(result.zip as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null)
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('slug') || '').slice(0, 80).trim()

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed
  return respondWithExport(authed, companyId)
}

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.slug || '').slice(0, 80).trim()

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed
  return respondWithExport(authed, companyId)
}
