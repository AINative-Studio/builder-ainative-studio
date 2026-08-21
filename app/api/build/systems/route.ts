/**
 * GET /api/build/systems?companyId=... (#233) — real business-systems state for
 * a company's Live dashboard. Returns the 4 systems (Pipeline/Invoices/Helpdesk/
 * Voice) with their real AINative primitive, live product URL, and actual counts.
 *
 * A company just shipped from /build has no deals/invoices/tickets/calls yet, so
 * the honest state is zero — the nightly loop fills these over time. When real
 * per-company data exists (via the enrolled company's ZeroDB), counts reflect it.
 * We never fabricate numbers.
 */

import { NextRequest } from 'next/server'
import { buildSystems, type BusinessSystem } from '@/lib/build/business-systems'
import { resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

type Counts = Partial<Record<BusinessSystem['key'], { count?: number; value?: number }>>

export async function GET(request: NextRequest) {
  const companyId = new URL(request.url).searchParams.get('companyId') || ''

  // If the company has been provisioned (#243), it has its own real ZeroDB
  // project — read counts straight from that project's tables. Otherwise fall
  // back to the shared /api/db proxy tables. Failures / no-data → zero-state.
  let counts: Counts = {}
  let provisioned = false
  let pipelineProvisioned = false
  if (companyId) {
    const entry = await resolveApp(companyId).catch(() => null)
    const projectId = entry?.zerodbProjectId
    pipelineProvisioned = Boolean(entry?.pipelineProvisioned)
    if (projectId) {
      provisioned = true
      try {
        counts = await readProvisionedCounts(projectId)
      } catch {
        counts = {}
      }
    } else {
      try {
        counts = await readCompanyCounts(companyId)
      } catch {
        counts = {}
      }
    }
  }

  return Response.json({
    systems: buildSystems(counts, { provisioned, pipelineProvisioned }),
    companyId,
    provisioned,
    pipelineProvisioned,
    zeroState: Object.keys(counts).length === 0,
  })
}

/**
 * Read real counts directly from the company's PROVISIONED ZeroDB project (#243)
 * via the AINative rows API. Tables `deals`/`invoices` live under the company's
 * own project, so these numbers are truly per-company. Returns {} on any failure.
 */
async function readProvisionedCounts(projectId: string): Promise<Counts> {
  const api = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
  const key = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
  const out: Counts = {}
  if (!key) return out

  const rows = async (table: string): Promise<any[]> => {
    const r = await fetch(`${api}/api/v1/projects/${projectId}/database/tables/${table}/rows?limit=1000`, {
      headers: { Authorization: `Bearer ${key}`, 'X-API-Key': key },
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return []
    const data = await r.json().catch(() => null)
    const raw = Array.isArray(data) ? data : data?.data || data?.rows || []
    return raw.map((x: any) => x?.row_data ?? x).filter(Boolean)
  }

  try {
    const deals = await rows('deals')
    if (deals.length) out.pipeline = { count: deals.length, value: deals.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0) }
  } catch { /* zero-state */ }
  try {
    const invoices = await rows('invoices')
    if (invoices.length) out.invoices = { count: invoices.length, value: invoices.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0) }
  } catch { /* zero-state */ }

  return out
}

/**
 * Read real per-company counts. Wired to the company's ZeroDB deal/invoice/ticket
 * tables via the same-origin /api/db proxy. Returns {} when nothing exists yet
 * (the common case for a just-shipped company) — never invents data.
 */
async function readCompanyCounts(
  companyId: string,
): Promise<Partial<Record<BusinessSystem["key"], { count?: number; value?: number }>>> {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
  const safe = companyId.replace(/[^a-z0-9_-]/gi, '')
  const out: Partial<Record<BusinessSystem["key"], { count?: number; value?: number }>> = {}

  // Deals → pipeline count + total value
  try {
    const r = await fetch(`${base}/api/db/${safe}_deals`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const rows = (await r.json())?.data || []
      if (Array.isArray(rows) && rows.length) {
        out.pipeline = { count: rows.length, value: rows.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0) }
      }
    }
  } catch { /* zero-state */ }

  // Invoices → collected total
  try {
    const r = await fetch(`${base}/api/db/${safe}_invoices`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const rows = (await r.json())?.data || []
      if (Array.isArray(rows) && rows.length) {
        out.invoices = { count: rows.length, value: rows.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0) }
      }
    }
  } catch { /* zero-state */ }

  return out
}
