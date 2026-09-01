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
  // Owner association (#253) — the AINative account email that built/claimed this
  // company. Set from the signed-in session at registration/plan/provision time.
  // Enables the "my companies" index (listAppsForOwner) so a founder can find their
  // built companies again. Absent for companies built anonymously (never signed in).
  ownerEmail?: string
  domain?: string  // custom domain purchased for this company (#240), if any
  // Bring-your-own connected domain (#53) — a domain the founder ALREADY owns and
  // wired to their provisioned Railway service via customDomainCreate. `byoDomain`
  // is the host; `byoDomainId` is the Railway customDomain id (for idempotent status
  // polls + re-opens); `byoDomainStatus` is the last-observed honest lifecycle state
  // (pending → verifying → live). Distinct from `domain` (a PURCHASED domain, #240).
  byoDomain?: string
  byoDomainId?: string
  byoDomainStatus?: 'pending' | 'verifying' | 'live' | 'error'
  byoDomainConnectedAt?: string
  plan?: string    // active subscription plan id (pro|business|enterprise) after checkout (#241)
  // Explicit subdomain claim (#78). The company's {slug}.ainative.studio host must NOT
  // resolve until the founder is on a PAID plan AND has explicitly claimed it (mirrors
  // how custom-domain / BYO-domain #53/#240 are paid-gated). Default false/undefined →
  // the subdomain does not resolve; the shareable preview stays the /build/{slug} path.
  // Set true only via claimSubdomain() after a paid-plan check.
  subdomainClaimed?: boolean
  subdomainClaimedAt?: string
  enrolled?: boolean  // Business+ auto-enrolled into the nightly loop (#241; cron itself is #243)
  // Persistent cloud provisioning (#243) — the REAL per-company data layer, created
  // via AINative Instant DB (POST /api/v1/public/instant-db). Present once provisioned.
  zerodbProjectId?: string
  provisionedAt?: string
  // The AINative Builder workspace (core Organization) this company's project is
  // filed under (#250). Set once the project has been (or was requested to be)
  // parented to the Builder workspace. `workspaceFiled` records whether the
  // re-parent actually stuck (admin-owned projects) vs is still pending core support.
  workspaceId?: string
  workspaceFiled?: boolean
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
  // ZeroCommerce (ecommerce primitive) provisioning (#417, child of #414). Same
  // JWT-auth pattern as ZeroPipeline — true once a real store was created for
  // the company. Absent/false = still simulated.
  commerceProvisioned?: boolean
  commerceStoreId?: string
  // OpenCapStack (cap table primitive) provisioning (#427, child of #414/#422).
  // Unlike ZeroPipeline/ZeroCommerce, auth is a dedicated service account (no
  // AINative-federated auth on OpenCapStack's side) — true once a real company
  // record was created there. Absent/false = still simulated.
  capstackProvisioned?: boolean
  capstackCompanyId?: string
  // ZeroForms (online-forms primitive) provisioning (#421, child of #414). Same
  // JWT-auth pattern as ZeroPipeline/ZeroCommerce — true once a real default
  // form was created for the company. Absent/false = still simulated.
  formsProvisioned?: boolean
  formsFormId?: string
  // The persistent hosting target for the company app (#243). Today this is the
  // durable preview URL; the deploy seam swaps in a real Railway/*.ainative.studio host.
  deployUrl?: string
  // Dedicated per-company Railway service (#243, heavy PAID-only option). Set once a
  // verified-paid company gets its OWN Railway service provisioned (its own backend,
  // custom-domain-bindable via #240). Presence makes the deploy idempotent: the verify
  // trigger skips creation when this is already set, so a re-run never creates a second
  // billable service. `railwayDeployedAt` records when it was first provisioned.
  railwayServiceId?: string
  railwayDeployedAt?: string
  // Per-company Gitea repository (#354, GIT-1). One private repo per company slug,
  // under one Gitea org per AINative workspace (org-per-workspace, epic #349). Set
  // once the repo is provisioned via lib/git/gitea-client (provisionCompanyRepo).
  // `gitRepoUrl` is the https clone URL, `gitRepoId` the numeric Gitea repo id
  // (stringified), `gitOrg` the workspace's Gitea org name. Presence makes repo
  // provisioning idempotent — the provisioner skips creation when already set.
  gitRepoUrl?: string
  gitRepoId?: string
  gitOrg?: string
  gitProvisionedAt?: string
  // Company lifecycle (#57, Danger Zone). Absent/'active' = the company is live and
  // its app is served. 'offline' = the founder took the app offline (kept, but not
  // served). 'deleted' = the founder deleted the company (soft delete — the row is
  // retained for audit; resolveApp() treats it as gone). The nightly loop is paused
  // separately via loop-enrollment (setLoopEnabled), which is orthogonal to this.
  lifecycleStatus?: 'active' | 'offline' | 'deleted'
  lifecycleAt?: string
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
 * Set a company's lifecycle state (#57, Danger Zone) — 'offline' (take the app
 * out of service, keep the company) or 'deleted' (soft-delete the company).
 * Appends an updated row carrying the existing chatId + brand plus the new
 * lifecycle status, so resolveApp() (latest-wins) reflects it. No-op (returns
 * false) if the slug isn't registered / already gone. Idempotent: re-setting the
 * same status is a successful no-op (no churn row).
 */
export async function setAppLifecycle(
  slug: string,
  status: 'active' | 'offline' | 'deleted',
): Promise<boolean> {
  const existing = await resolveApp(slug)
  if (!existing) return false
  if ((existing.lifecycleStatus || 'active') === status) return true
  return registerApp({ ...existing, lifecycleStatus: status, lifecycleAt: new Date().toISOString() })
}

/**
 * Persist a bring-your-own connected domain on a company (#53). Appends an updated
 * row carrying the existing entry plus the founder's connected domain, the Railway
 * customDomain id, and the last-observed status, so resolveApp() (latest-wins)
 * surfaces the connection and re-opening the modal shows current status (idempotent).
 *
 * Idempotent no-op success (true) when the same domain + status is already stored, so
 * repeated status polls never append churn rows. No-op (false) if slug isn't registered.
 */
export async function setAppByoDomain(
  slug: string,
  fields: { domain: string; byoDomainId?: string; status?: 'pending' | 'verifying' | 'live' | 'error' },
): Promise<boolean> {
  const host = (fields.domain || '').trim().toLowerCase()
  if (!host) return false
  const existing = await resolveApp(slug)
  if (!existing) return false
  // Nothing changed → skip the write (avoid churn on repeat polls).
  if (
    (existing.byoDomain || '').toLowerCase() === host &&
    existing.byoDomainId === fields.byoDomainId &&
    existing.byoDomainStatus === fields.status
  ) {
    return true
  }
  return registerApp({
    ...existing,
    byoDomain: host,
    byoDomainId: fields.byoDomainId ?? existing.byoDomainId,
    byoDomainStatus: fields.status ?? existing.byoDomainStatus,
    byoDomainConnectedAt: existing.byoDomainConnectedAt || new Date().toISOString(),
  })
}

/**
 * Associate a company with its owner's AINative account email (#253). Appends an
 * updated row carrying the existing entry plus ownerEmail, so resolveApp()
 * (latest-wins) surfaces it and listAppsForOwner() can find it. Idempotent no-op
 * (returns true) when the owner is already set to the same email. No-op (false)
 * if the slug isn't registered or no email is given.
 */
export async function setAppOwner(slug: string, ownerEmail: string): Promise<boolean> {
  const email = (ownerEmail || '').trim().toLowerCase()
  if (!email) return false
  const existing = await resolveApp(slug)
  if (!existing) return false
  if ((existing.ownerEmail || '').toLowerCase() === email) return true
  return registerApp({ ...existing, ownerEmail: email })
}

/**
 * Migrate anonymous guest-built companies to a real AINative account (#49).
 *
 * When a founder builds a company as an anonymous guest and THEN registers or
 * logs in, their in-progress work must not be lost: this claims the given guest
 * company slugs for the now-authenticated account by stamping ownerEmail, so the
 * companies surface in listAppsForOwner() (the "my companies" index) under the
 * real account.
 *
 * SAFETY — only UNOWNED companies are claimed. A row that already carries a
 * DIFFERENT ownerEmail is skipped (never stolen); a row already owned by THIS
 * email is a no-op success (idempotent, so re-running the migration on repeat
 * logins is harmless). Unregistered slugs are skipped. Returns the slugs that
 * were newly migrated plus the ones skipped, so the caller can log without
 * failing the sign-in path.
 */
export async function migrateGuestCompanies(
  slugs: string[],
  ownerEmail: string,
): Promise<{ migrated: string[]; skipped: string[] }> {
  const email = (ownerEmail || '').trim().toLowerCase()
  const migrated: string[] = []
  const skipped: string[] = []
  if (!email || !Array.isArray(slugs) || slugs.length === 0) {
    return { migrated, skipped }
  }
  // De-duplicate + drop empties so a repeated slug isn't processed twice.
  const unique = Array.from(new Set(slugs.map((s) => (s || '').trim()).filter(Boolean)))
  for (const slug of unique) {
    const existing = await resolveApp(slug).catch(() => null)
    if (!existing) {
      skipped.push(slug)
      continue
    }
    const currentOwner = (existing.ownerEmail || '').toLowerCase()
    // Already owned by this account → nothing to do (idempotent).
    if (currentOwner === email) {
      migrated.push(slug)
      continue
    }
    // Owned by SOMEONE ELSE → never steal it.
    if (currentOwner && currentOwner !== email) {
      skipped.push(slug)
      continue
    }
    // Unowned (built as guest) → claim it for this account.
    const ok = await registerApp({ ...existing, ownerEmail: email }).catch(() => false)
    if (ok) migrated.push(slug)
    else skipped.push(slug)
  }
  return { migrated, skipped }
}

/**
 * List the companies owned by a given AINative account email (#253) — the data
 * behind the "my companies" index. Reads all registry rows, keeps only the
 * latest row per slug (latest-wins, matching resolveApp), then filters to those
 * whose ownerEmail matches. Returns most-recently-created first. Empty on any
 * error or when unconfigured, so the surface degrades gracefully.
 */
export async function listAppsForOwner(ownerEmail: string): Promise<AppEntry[]> {
  const email = (ownerEmail || '').trim().toLowerCase()
  if (!configured() || !email) return []
  return (await listAllApps()).filter((e) => (e.ownerEmail || '').toLowerCase() === email)
}

/**
 * Every registered company, collapsed to the latest row per slug (latest-wins,
 * matching resolveApp), most-recently-created first. Empty on any error or when
 * unconfigured. Used by the winback sweep (#344) to find dormant owners; the
 * caller applies its own filters (has ownerEmail, not deleted, inactive N days).
 */
export async function listAllApps(): Promise<AppEntry[]> {
  if (!configured()) return []
  try {
    const res = await fetch(`${rowsUrl()}?limit=1000`, { headers: headers(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = JSON.parse(await res.text())
    const rows = Array.isArray(data) ? data : data.data || data.rows || []
    const entries: AppEntry[] = rows
      .map((r: { row_data?: AppEntry }) => r.row_data)
      .filter((rd: AppEntry | undefined): rd is AppEntry => !!rd?.slug && !!rd?.chatId)
    // Collapse to the latest row per slug (latest createdAt wins).
    const latest = new Map<string, AppEntry>()
    for (const e of entries) {
      const prev = latest.get(e.slug)
      if (!prev || (e.createdAt || '').localeCompare(prev.createdAt || '') > 0) latest.set(e.slug, e)
    }
    return Array.from(latest.values())
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  } catch {
    return []
  }
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
 * Claim a company's {slug}.ainative.studio subdomain (#78) — the paid-gated action
 * behind the "claim your subdomain" button on Live. Sets subdomainClaimed=true so the
 * edge middleware (subdomainServable) begins serving the host. PAID-ONLY: mirrors how
 * custom-domain / BYO-domain (#53/#240) are gated — the claim is refused unless the
 * company is on a paid plan. The plan is re-read from the registry entry (the source of
 * truth persisted by setAppPlan) rather than trusted from the client.
 *
 * Idempotent: no-op success (true) when already claimed. Returns { ok, claimed, reason }
 * so the caller can surface an honest message (not_registered / not_paid) without throwing.
 */
export async function claimSubdomain(
  slug: string,
): Promise<{ ok: boolean; claimed: boolean; reason?: string }> {
  const existing = await resolveApp(slug)
  if (!existing) return { ok: false, claimed: false, reason: 'not_registered' }
  // Paid gate — a subdomain can only be claimed on a paid plan (#78).
  const plan = String(existing.plan || '').toLowerCase()
  const paid = plan === 'pro' || plan === 'business' || plan === 'enterprise' || plan === 'cody_vcto'
  if (!paid) return { ok: false, claimed: false, reason: 'not_paid' }
  // Already claimed → idempotent success, no churn row.
  if (existing.subdomainClaimed === true) return { ok: true, claimed: true }
  const ok = await registerApp({
    ...existing,
    subdomainClaimed: true,
    subdomainClaimedAt: existing.subdomainClaimedAt || new Date().toISOString(),
  })
  return { ok, claimed: ok, reason: ok ? undefined : 'write_failed' }
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
    commerceProvisioned?: boolean
    commerceStoreId?: string
    capstackProvisioned?: boolean
    capstackCompanyId?: string
    formsProvisioned?: boolean
    formsFormId?: string
    workspaceId?: string
    workspaceFiled?: boolean
    railwayServiceId?: string
    railwayDeployedAt?: string
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
 * Persist a company's dedicated per-company Railway service (#243) after a
 * verified-paid deploy. Appends an updated row carrying the existing entry plus the
 * new railwayServiceId (+ the real deploy URL, which supersedes the durable preview
 * URL) so resolveApp() (latest-wins) and Live surface the real host.
 *
 * IDEMPOTENCY: no-op success (returns true) when the same railwayServiceId is already
 * stored — the verify trigger checks the registry before creating, but this guards the
 * write path too, so a re-run never appends a churn row. No-op (false) if the slug
 * isn't registered.
 */
export async function setAppRailwayService(
  slug: string,
  fields: { railwayServiceId: string; deployUrl?: string; domain?: string },
): Promise<boolean> {
  if (!fields.railwayServiceId) return false
  const existing = await resolveApp(slug)
  if (!existing) return false
  // Already recorded this exact service → nothing to write.
  if (existing.railwayServiceId === fields.railwayServiceId) return true
  return registerApp({
    ...existing,
    railwayServiceId: fields.railwayServiceId,
    railwayDeployedAt: existing.railwayDeployedAt || new Date().toISOString(),
    // A real Railway host supersedes the durable-preview deployUrl.
    deployUrl: fields.deployUrl || existing.deployUrl,
    domain: fields.domain || existing.domain,
  })
}

/**
 * Attach a per-company Gitea repository to a company (#354, GIT-1). Appends an updated
 * row with the git fields so resolveApp() (latest-wins) surfaces the repo handle.
 *
 * IDEMPOTENCY: no-op success (returns true) when the same gitRepoId is already stored —
 * provisionCompanyRepo checks the registry before creating, but this guards the write
 * path too, so a re-run never appends a churn row. No-op (false) if the slug isn't
 * registered or required fields are missing.
 */
export async function setAppGitRepo(
  slug: string,
  fields: { gitRepoUrl: string; gitRepoId: string; gitOrg: string },
): Promise<boolean> {
  if (!fields.gitRepoUrl || !fields.gitRepoId || !fields.gitOrg) return false
  const existing = await resolveApp(slug)
  if (!existing) return false
  // Already recorded this exact repo → nothing to write.
  if (existing.gitRepoId === fields.gitRepoId) return true
  return registerApp({
    ...existing,
    gitRepoUrl: fields.gitRepoUrl,
    gitRepoId: fields.gitRepoId,
    gitOrg: fields.gitOrg,
    gitProvisionedAt: existing.gitProvisionedAt || new Date().toISOString(),
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
    // #250: now that the project is claimed (associated to a real account and
    // permanent), re-attempt filing it under the Builder workspace. Best-effort —
    // must never fail the claim. Dynamic import avoids a static import cycle
    // (instant-db.ts is otherwise only imported by the provision route).
    let workspaceFiled = existing.workspaceFiled
    try {
      const { fileProjectUnderBuilderWorkspace, BUILDER_WORKSPACE_ID } = await import('./instant-db')
      const filed = await fileProjectUnderBuilderWorkspace(existing.zerodbProjectId)
      workspaceFiled = filed.filed
      // Persist the intended workspace even if the re-parent is still blocked, so a
      // migration sweep can find it.
      ;(existing as AppEntry).workspaceId = existing.workspaceId || BUILDER_WORKSPACE_ID
    } catch { /* best-effort */ }

    // Flip to permanent; drop the now-spent claim token.
    await registerApp({
      ...existing,
      keyKind: 'permanent',
      claimToken: undefined,
      claimedAt: new Date().toISOString(),
      workspaceFiled,
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
    const latest = matches[0]
    // A soft-deleted company (#57 Danger Zone) is treated as gone — the /build/{slug}
    // route then 404s honestly instead of serving a deleted app.
    if (latest.lifecycleStatus === 'deleted') return null
    return latest
  } catch {
    return null
  }
}
