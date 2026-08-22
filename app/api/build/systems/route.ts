/**
 * GET /api/build/systems?companyId=...&idea=... (#233, #288) — real business-systems
 * state for a company's Live dashboard. Returns IDEA-DRIVEN systems (not the same
 * 4 hardcoded primitives for every company) with their real AINative primitive,
 * in-Builder URL (never a marketing site — #278), and actual counts.
 *
 * A company just shipped from /build has no deals/invoices/tickets/calls yet, so
 * the honest state is zero — the nightly loop fills these over time. When real
 * per-company data exists (via the enrolled company's ZeroDB), counts reflect it.
 * We never fabricate numbers.
 */

import { NextRequest } from 'next/server'
import { buildSystems } from '@/lib/build/business-systems'
import { resolveApp } from '@/lib/build/app-registry'

export const runtime = 'nodejs'

type Counts = Record<string, { count?: number; value?: number }>

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams
  const companyId = params.get('companyId') || ''
  // idea drives primitive selection — must be passed by the Live dashboard
  const idea = params.get('idea') || ''

  let counts: Counts = {}
  let provisioned = false
  let pipelineProvisioned = false
  let instanceUrls: Record<string, string> = {}

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

  const systems = buildSystems(idea, counts, { provisioned, pipelineProvisioned, instanceUrls })

  return Response.json({
    systems,
    companyId,
    idea,
    provisioned,
    pipelineProvisioned,
    zeroState: Object.keys(counts).length === 0,
  })
}

/**
 * Read real counts directly from the company's PROVISIONED ZeroDB project (#243)
 * via the AINative rows API. Returns {} on any failure.
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
  try {
    const orders = await rows('orders')
    if (orders.length) out.orders = { count: orders.length, value: orders.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0) }
  } catch { /* zero-state */ }
  try {
    const tickets = await rows('tickets')
    if (tickets.length) out.tickets = { count: tickets.length }
  } catch { /* zero-state */ }
  try {
    const calls = await rows('calls')
    if (calls.length) out.calls = { count: calls.length }
  } catch { /* zero-state */ }

  return out
}

/**
 * Read real per-company counts via the same-origin /api/db proxy.
 * Returns {} when nothing exists yet (common for a just-shipped company).
 */
async function readCompanyCounts(companyId: string): Promise<Counts> {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
  const safe = companyId.replace(/[^a-z0-9_-]/gi, '')
  const out: Counts = {}

  const tryTable = async (table: string, key: string, valueFn?: (rows: any[]) => number) => {
    try {
      const r = await fetch(`${base}/api/db/${safe}_${table}`, { signal: AbortSignal.timeout(4000) })
      if (r.ok) {
        const rows = (await r.json())?.data || []
        if (Array.isArray(rows) && rows.length) {
          out[key] = { count: rows.length, value: valueFn ? valueFn(rows) : undefined }
        }
      }
    } catch { /* zero-state */ }
  }

  await Promise.allSettled([
    tryTable('deals', 'pipeline', (rows) => rows.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0)),
    tryTable('invoices', 'invoices', (rows) => rows.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)),
    tryTable('orders', 'orders', (rows) => rows.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0)),
    tryTable('tickets', 'tickets'),
    tryTable('calls', 'calls'),
  ])

  return out
}
