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
  // Persistent cloud provisioning (#243) — the REAL per-company data layer, created
  // via AINative Instant DB (POST /api/v1/public/instant-db). Present once provisioned.
  zerodbProjectId?: string
  provisionedAt?: string
  // When a tmp_ trial project expires (72h ISO from Instant DB). Undefined for
  // permanent projects. Drives the "trial expires in X — upgrade to keep it" UI (#207).
  trialExpiresAt?: string
  // Which kind of Instant DB key backs this project (#243, per user directive):
  //  'tmp'       — UNPAID provision → tmp_ key, 72h trial, must be claimed on payment.
  //  'permanent' — PAID provision (sk_ key) OR a tmp_ project already claimed.
  keyKind?: 'tmp' | 'permanent'
  // Claim token for a tmp_ project, needed to upgrade tmp_ → permanent on payment
  // via /api/v1/public/instant-db/claim (#243). Only set while keyKind === 'tmp'.
  // NOTE: this is the *claim* secret, NOT the data-plane api_key. The raw sk_/tmp_
  // key is intentionally NOT persisted in this shared registry (see setAppProvisioned).
  claimToken?: string
  claimedAt?: string
  // ZeroPipeline (CRM primitive) provisioning (#243, directive C). True once a real
  // pipeline was created for the company via the founder's JWT. Requires a signed-in
  // founder (ZeroPipeline is JWT-auth, not api-key). Absent/false = still simulated.
  pipelineProvisioned?: boolean
  pipelineId?: string
  // The persistent hosting target for the company app (#243). Today this is the
  // durable preview URL; the deploy seam swaps in a real Railway/*.ainative.studio host.
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
 * (and any domain/provisioning) plus the new plan, so resolveApp() (latest-wins)
 * surfaces it. `enrolled` is set for Business+ tiers — auto-enrollment intent into
 * the nightly loop (the cron itself is #243). No-op (false) if slug isn't registered.
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
 * row carrying the existing chatId + brand plus the provisioned Instant DB project
 * id, key kind, and (for tmp_ keys) the claim token, so resolveApp() (latest-wins)
 * surfaces it. No-op (false) if the slug isn't registered.
 *
 * SECURITY NOTE: we deliberately do NOT persist the raw Instant DB api_key
 * (sk_/tmp_) in this shared registry table — it is a data-plane secret. The
 * generated company app receives/uses its key server-side (env / secret store),
 * and the Live dashboard reads the company's data with the Builder's own server
 * key scoped by project_id. Only the project_id (an identifier) and the claim
 * token (needed to upgrade tmp_ → permanent on payment) are stored here.
 */
export async function setAppProvisioned(
  slug: string,
  fields: {
    zerodbProjectId?: string
    deployUrl?: string
    provisionedAt?: string
    trialExpiresAt?: string
    keyKind?: 'tmp' | 'permanent'
    claimToken?: string
    pipelineProvisioned?: boolean
    pipelineId?: string
  },
): Promise<boolean> {
  const existing = await resolveApp(slug)
  if (!existing) return false
  return registerApp({
    ...existing,
    ...fields,
    provisionedAt: fields.provisionedAt || new Date().toISOString(),
  })
}

/**
 * Upgrade a company's tmp_ Instant DB project to a PERMANENT one on payment (#243).
 *
 * When an anonymous founder provisions, they get a tmp_ key (72h expiry). Once they
 * pay and have an account, the #241 post-checkout return path calls this with the
 * founder's AINative JWT: it hits /api/v1/public/instant-db/claim with the stored
 * {project_id, token} to associate the project to their account and mint a permanent
 * key, then flips keyKind → 'permanent' on the registry so it never expires.
 *
 * Idempotent: no-op success if already permanent or nothing to claim. Returns
 * { ok, claimed, reason? } so the caller can log without failing checkout.
 */
export async function claimCompanyProject(
  slug: string,
  jwt: string,
): Promise<{ ok: boolean; claimed: boolean; reason?: string }> {
  const existing = await resolveApp(slug)
  if (!existing) return { ok: false, claimed: false, reason: 'not_registered' }
  // Nothing to claim: never provisioned, or already permanent.
  if (!existing.zerodbProjectId || existing.keyKind !== 'tmp') {
    return { ok: true, claimed: false, reason: existing.keyKind === 'permanent' ? 'already_permanent' : 'not_tmp' }
  }
  if (!existing.claimToken) return { ok: false, claimed: false, reason: 'no_claim_token' }
  if (!jwt) return { ok: false, claimed: false, reason: 'no_jwt' }

  try {
    const res = await fetch(`${AINATIVE_API}/api/v1/public/instant-db/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      // The core claim endpoint expects { token, project_id } (verified live).
      body: JSON.stringify({ token: existing.claimToken, project_id: existing.zerodbProjectId }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json().catch(() => null)
    // 409 = already claimed → treat as success (idempotent), just record permanence.
    const alreadyClaimed = res.status === 409
    if (!res.ok && !alreadyClaimed) {
      return { ok: false, claimed: false, reason: String(data?.detail || res.status).slice(0, 120) }
    }
    // Flip to permanent; drop the now-spent claim token.
    await registerApp({
      ...existing,
      keyKind: 'permanent',
      claimToken: undefined,
      claimedAt: new Date().toISOString(),
    })
    return { ok: true, claimed: !alreadyClaimed }
  } catch (e: any) {
    return { ok: false, claimed: false, reason: String(e?.message || e).slice(0, 120) }
  }
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
