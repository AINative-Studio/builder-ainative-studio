/**
 * /api/build/export (#63.C) — download YOUR company's data. "You own 100% — take
 * your data anytime."
 *
 * Exports the company's OWN ZeroDB project (provisioned per-company via Instant DB,
 * #243) as a downloadable JSON or CSV file. This is a core data-ownership
 * differentiator vs a closed box: the founder can pull all their data whenever.
 *
 * Auth: a REAL (non-guest) session that OWNS the company. The data is the founder's
 * private business data — never exportable cross-owner or by a guest.
 *
 *   GET ?companyId=…&format=json|csv  → file download (Content-Disposition: attachment)
 *   POST { companyId, format }        → same (for agent/programmatic callers)
 *
 * The response is streamed as an attachment with a timestamped filename so the
 * browser downloads it directly.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/app/(auth)/auth'
import { deriveOwnerKey } from '@/lib/build/chat-store'
import { resolveApp, type AppEntry } from '@/lib/build/app-registry'
import {
  buildCompanyExport,
  serializeExport,
  exportFileName,
  exportContentType,
  isExportFormat,
  type ExportFormat,
} from '@/lib/build/company-export'
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

/** Build the export and return it as an attachment download, or a JSON error. */
async function respondWithExport(entry: AppEntry, companyId: string, format: ExportFormat): Promise<Response> {
  const projectId = entry.zerodbProjectId
  if (!projectId) {
    return Response.json({ error: 'this company has no data project to export yet' }, { status: 400 })
  }

  const result = await buildCompanyExport(projectId)
  if (!result.ok || !result.export) {
    return Response.json({ error: result.reason || 'export unavailable' }, { status: 502 })
  }

  const payload = serializeExport(result.export, format)
  const filename = exportFileName(entry.slug || companyId, format)
  logger.info('company data exported', {
    companyId,
    format,
    tableCount: result.export.tableCount,
    rowCount: result.export.rowCount,
  })
  return new Response(payload, {
    status: 200,
    headers: {
      'Content-Type': exportContentType(format),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  const session = await auth().catch(() => null)
  const params = request.nextUrl.searchParams
  const companyId = String(params.get('companyId') || params.get('slug') || '').slice(0, 80).trim()
  const fmtRaw = String(params.get('format') || 'json').toLowerCase()
  const format: ExportFormat = isExportFormat(fmtRaw) ? fmtRaw : 'json'

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed
  return respondWithExport(authed, companyId, format)
}

export async function POST(request: NextRequest) {
  const session = await auth().catch(() => null)
  const body = await request.json().catch(() => null)
  const companyId = String(body?.companyId || body?.slug || '').slice(0, 80).trim()
  const fmtRaw = String(body?.format || 'json').toLowerCase()
  const format: ExportFormat = isExportFormat(fmtRaw) ? fmtRaw : 'json'

  const authed = await authorizeCompany(session, companyId)
  if (authed instanceof Response) return authed
  return respondWithExport(authed, companyId, format)
}
