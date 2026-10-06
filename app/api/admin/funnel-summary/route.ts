import { NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getAinativeApiKey } from '@/lib/build/env-keys'

export const runtime = 'nodejs'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const FUNNEL_TABLE = 'builder_funnel_events'

interface FunnelRow {
  event: string
  companyId: string | null
  track: 'app' | 'company'
  step: string
  timestamp: string
}

/**
 * Admin-only funnel baseline (#BLD-06.12) — the two aggregate numbers the
 * epic asks for: share of ventures reaching the last step, and median
 * time from first artifact to last step. Gated by requireAdmin(), the
 * SAME real check app/api/admin/errors/route.ts already uses — never a
 * weaker/duplicated check.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return Response.json({ error: admin.message }, { status: admin.status })

  if (!API_KEY || !PROJECT_ID) {
    return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
  }

  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${FUNNEL_TABLE}/rows?limit=5000`,
      { headers: { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY }, signal: AbortSignal.timeout(20000) },
    )
    if (!res.ok) return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
    const data = JSON.parse(await res.text())
    const rows: FunnelRow[] = (Array.isArray(data) ? data : data.data || data.rows || [])
      .map((r: { row_data?: FunnelRow }) => r.row_data)
      .filter(Boolean)

    const byCompany = new Map<string, FunnelRow[]>()
    for (const r of rows) {
      if (!r.companyId) continue
      if (!byCompany.has(r.companyId)) byCompany.set(r.companyId, [])
      byCompany.get(r.companyId)!.push(r)
    }

    const sampleSize = byCompany.size
    let reached = 0
    const durationsMs: number[] = []
    for (const companyRows of byCompany.values()) {
      const first = companyRows.find((r) => r.event === 'idea_submitted')
      const last = companyRows.find((r) => r.event === 'last_step_reached')
      if (last) reached++
      if (first && last) {
        durationsMs.push(new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime())
      }
    }
    durationsMs.sort((a, b) => a - b)
    const median = durationsMs.length
      ? durationsMs[Math.floor(durationsMs.length / 2)]
      : null

    return Response.json({
      shareReachingLastStep: sampleSize ? reached / sampleSize : 0,
      medianTimeFirstArtifactToLastStepMs: median,
      sampleSize,
    })
  } catch {
    return Response.json({ shareReachingLastStep: 0, medianTimeFirstArtifactToLastStepMs: null, sampleSize: 0 })
  }
}
