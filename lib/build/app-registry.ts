/**
 * App registry (#207 · FIX-2) — maps a company/app brand slug to the generated
 * app's preview chatId, so the subdirectory URL /build/{slug} resolves to the
 * REAL running app. Persisted to ZeroDB (table: builder_app_registry) so the
 * link survives restarts and is shareable. Falls back to null when unconfigured.
 */

const AINATIVE_API = process.env.AINATIVE_API_URL || 'https://api.ainative.studio'
const API_KEY = process.env.AINATIVE_API_KEY || process.env.ZERODB_API_KEY || ''
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || ''
const TABLE = 'builder_app_registry'

function rowsUrl(): string {
  return `${AINATIVE_API}/api/v1/projects/${PROJECT_ID}/database/tables/${TABLE}/rows`
}
function headers(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'X-API-Key': API_KEY, 'Content-Type': 'application/json' }
}
function configured(): boolean {
  return Boolean(API_KEY && PROJECT_ID)
}

export interface AppEntry {
  slug: string
  chatId: string
  name?: string
  tagline?: string
  color?: string
  track?: string
  domain?: string  // custom domain purchased for this company (#240), if any
  createdAt: string
}

/** Register (or update) a slug → chatId mapping. Appends a row; latest wins on read. */
export async function registerApp(e: Omit<AppEntry, 'createdAt'>): Promise<boolean> {
  if (!configured() || !e.slug || !e.chatId) return false
  try {
    const res = await fetch(rowsUrl(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ row_data: { ...e, createdAt: new Date().toISOString() } }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Attach a purchased custom domain to a company (#240). Appends an updated row
 * carrying the existing chatId + brand plus the new domain, so resolveApp()
 * (latest-wins) surfaces it. No-op (returns false) if the slug isn't registered.
 */
export async function setAppDomain(slug: string, domain: string): Promise<boolean> {
  const existing = await resolveApp(slug)
  if (!existing) return false
  return registerApp({ ...existing, domain })
}

/** Resolve a slug to its most recent app entry (chatId + brand), or null. */
export async function resolveApp(slug: string): Promise<AppEntry | null> {
  if (!configured() || !slug) return null
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const matches = rows
      .map((r: { row_data?: AppEntry }) => r.row_data)
      .filter((rd: AppEntry | undefined): rd is AppEntry => rd?.slug === slug && !!rd?.chatId)
    if (!matches.length) return null
    matches.sort((a: AppEntry, b: AppEntry) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    return matches[0]
  } catch {
    return null
  }
}
