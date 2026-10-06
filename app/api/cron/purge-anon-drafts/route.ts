import { NextRequest, NextResponse } from 'next/server'
import { getAinativeApiKey } from '@/lib/build/env-keys'

export const runtime = 'nodejs'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const DRAFTS_TABLE = 'builder_anon_drafts'
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, as disclosed to the user at kickoff

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}

/**
 * Purge anonymous drafts older than 30 days (#E3.4) — same CRON_SECRET-gated
 * GET pattern as the existing cron routes (app/api/cron/comms-digest,
 * winback, alerts). A genuine hard delete, not a soft-delete flag — matches
 * the explicit retention promise shown to the user at kickoff.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!API_KEY || !PROJECT_ID) {
    return NextResponse.json({ purged: 0, total: 0 })
  }

  try {
    const res = await fetch(
      `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows?limit=5000`,
      { headers: headers(), signal: AbortSignal.timeout(20000) },
    )
    if (!res.ok) return NextResponse.json({ purged: 0, total: 0 })
    const rows: Array<{ row_id: string; row_data?: { updatedAt?: string } }> = await res.json().catch(() => [])
    const cutoff = Date.now() - RETENTION_MS

    let purged = 0
    for (const row of rows) {
      const updatedAt = row.row_data?.updatedAt
      if (!updatedAt || new Date(updatedAt).getTime() >= cutoff) continue
      try {
        await fetch(
          `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${DRAFTS_TABLE}/rows/${row.row_id}`,
          { method: 'DELETE', headers: headers(), signal: AbortSignal.timeout(15000) },
        )
        purged++
      } catch { /* best-effort — a missed purge just means it's retried next run */ }
    }

    return NextResponse.json({ purged, total: rows.length })
  } catch {
    return NextResponse.json({ purged: 0, total: 0 })
  }
}
