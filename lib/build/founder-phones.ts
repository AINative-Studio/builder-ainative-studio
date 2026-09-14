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
