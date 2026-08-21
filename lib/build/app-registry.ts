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
  plan?: string    // active subscription plan id (pro|business|enterprise) after checkout (#241)
  enrolled?: boolean  // Business+ auto-enrolled into the nightly loop (#241; cron itself is #243)
  // Persistent cloud provisioning (#243) — the REAL per-company ZeroDB project
  // created via core's /api/v1/zerodb/projects/ensure. Present once provisioned.
  zerodbProjectId?: string
  provisionedAt?: string
  // The persistent hosting target for the company app (#243). Today this is the
  // durable preview URL; the deploy seam swaps in a real Railway/*.ainative.app host.
  deployUrl?: string
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

/**
 * Persist the active subscription plan on a company (#241), mirroring
 * setAppDomain. Appends an updated row carrying the existing chatId + brand
 * (and any domain) plus the new plan, so resolveApp() (latest-wins) surfaces it.
 * `enrolled` is set for Business+ tiers — auto-enrollment intent into the nightly
 * loop (the cron itself is #243). No-op (false) if the slug isn't registered.
 */
export async function setAppPlan(slug: string, plan: string): Promise<boolean> {
  const existing = await resolveApp(slug)
  if (!existing) return false
  // Business and Enterprise auto-enroll into the nightly improvement loop.
  const enrolled = plan === 'business' || plan === 'enterprise' || plan === 'cody_vcto'
  return registerApp({ ...existing, plan, enrolled })
}

/**
 * Attach persistent-cloud provisioning to a company (#243). Appends an updated
 * row carrying the existing chatId + brand plus the provisioned ZeroDB project id
 * (and optional deploy URL), so resolveApp() (latest-wins) surfaces it. No-op
 * (returns false) if the slug isn't registered.
 */
export async function setAppProvisioned(
  slug: string,
  fields: { zerodbProjectId?: string; deployUrl?: string; provisionedAt?: string },
): Promise<boolean> {
  const existing = await resolveApp(slug)
  if (!existing) return false
  return registerApp({
    ...existing,
    ...fields,
    provisionedAt: fields.provisionedAt || new Date().toISOString(),
  })
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
