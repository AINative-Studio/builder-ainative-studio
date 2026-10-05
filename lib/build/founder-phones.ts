/**
 * Founder phone registry (#734). Core's real `/api/v1/auth/register` (see
 * app/api/build/register/route.ts) has no documented phone field in this
 * repo's existing integration (checked: no prior call site sends one,
 * docs/AINATIVE_PRIMITIVES.md documents no such contract) — rather than
 * assume undocumented support, phone numbers captured at registration are
 * stored in Builder's OWN ZeroDB, following the exact table-access pattern
 * lib/build/app-registry.ts already uses (append-only rows, latest-wins
 * read) so this stays consistent with the rest of the codebase instead of
 * inventing a new persistence pattern.
 */

import { getAinativeApiKey } from '@/lib/build/env-keys'

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = getAinativeApiKey()
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_founder_phones'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface FounderPhoneEntry {
  email: string
  phone: string
  verified: boolean
  createdAt: string
}

/** Append a founder→phone association (unverified by default). Best-effort. */
export async function recordFounderPhone(email: string, phone: string): Promise<boolean> {
  if (!configured() || !email || !phone) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: { email, phone, verified: false, createdAt: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Mark the most recent phone entry for this email as verified. Best-effort. */
export async function markFounderPhoneVerified(email: string, phone: string): Promise<boolean> {
  if (!configured() || !email || !phone) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        row_data: { email, phone, verified: true, createdAt: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Find the founder who owns a verified phone number (#936). Only a
 * `verified: true` row matches — an unverified phone entry (recorded but
 * never OTP-confirmed) must not grant SMS access to someone else's account
 * via a spoofed `From`. Picks the LATEST verified row when multiple exist
 * (latest-wins, matching this file's append-only write pattern). Returns
 * null on no match or any failure — never throws.
 */
export async function findFounderByPhone(e164: string): Promise<{ email: string } | null> {
  if (!configured() || !e164) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const entries: FounderPhoneEntry[] = rows
      .map((r: { row_data?: FounderPhoneEntry }) => r.row_data)
      .filter((rd: FounderPhoneEntry | undefined): rd is FounderPhoneEntry =>
        !!rd && rd.phone === e164 && rd.verified === true,
      )
    if (entries.length === 0) return null
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return { email: entries[0].email }
  } catch {
    return null
  }
}
