/**
 * Per-company Railway service provisioner (#243).
 *
 * This is the HEAVIER deploy option deploy.ts documents: on a VERIFIED PAID
 * subscription, provision a company its OWN dedicated Railway service (its own
 * backend/host) under the shared "AINative Studio - Production" Railway project,
 * so the app has real persistent hosting and can bind a custom domain (#240).
 *
 * It talks to the Railway GraphQL API (https://backboard.railway.com/graphql/v2)
 * with a service account token. The flow per company is:
 *   1. serviceCreate — a new service in the fixed AINATIVE Studio Production project,
 *      built from the shared company-app source (a GitHub repo or a Docker image).
 *   2. serviceInstanceUpdate/Deploy — set the environment + trigger the first deploy.
 *   3. serviceDomainCreate — mint a *.up.railway.app domain so the app is reachable
 *      and a custom domain (#240) can CNAME onto it.
 *
 * COST SAFETY: creating a service provisions real, billable hosting. This module
 * therefore NEVER runs unless (a) railwayDeployEnabled() is true (RAILWAY_DEPLOY_ENABLED
 * === 'true' AND a token AND the project id are configured) and (b) the caller has
 * already verified payment. The verify route + deploy.ts enforce (b); this module
 * enforces (a) so it is inert by default (e.g. in tests / preview envs), returning a
 * structured { ok:false, reason } instead of hitting the API.
 *
 * IDEMPOTENCY: this module does NOT itself dedupe across calls (it has no persistence);
 * the app-registry is the source of truth. Callers MUST check for an existing
 * railwayServiceId on the company BEFORE calling ensureCompanyService() and skip if
 * present, so re-running verify for an already-deployed company never creates a second
 * (billable) service. See deployPersistent() in deploy.ts.
 */

const RAILWAY_API_URL =
  process.env.RAILWAY_API_URL || 'https://backboard.railway.com/graphql/v2'

/** Service-account token for the Railway GraphQL API. */
function railwayToken(): string {
  return process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || ''
}

/**
 * The fixed Railway project every per-company service is created under:
 * "AINative Studio - Production" (47539617-ae34-4a52-a010-a88d875f347e).
 * Overridable via RAILWAY_COMPANY_PROJECT_ID.
 */
export function companyProjectId(): string {
  return (
    process.env.RAILWAY_COMPANY_PROJECT_ID ||
    '47539617-ae34-4a52-a010-a88d875f347e'
  )
}

/** The environment (id) new company services deploy into. Defaults to the project's
 *  production environment; overridable via RAILWAY_COMPANY_ENVIRONMENT_ID. */
function companyEnvironmentId(): string {
  return process.env.RAILWAY_COMPANY_ENVIRONMENT_ID || ''
}

/**
 * The shared source every per-company service builds from. Two supported forms:
 *  - RAILWAY_COMPANY_SOURCE_IMAGE: a Docker image ref (e.g. ghcr.io/ainative/company-runtime:latest)
 *  - RAILWAY_COMPANY_SOURCE_REPO:  a GitHub repo (e.g. "AINative-Studio/company-runtime")
 * The company's data layer (Instant DB project) and slug are injected as service
 * variables so one image serves any company. Image takes precedence when both set.
 */
function companySource(): { image?: string; repo?: string } {
  return {
    image: process.env.RAILWAY_COMPANY_SOURCE_IMAGE || undefined,
    repo: process.env.RAILWAY_COMPANY_SOURCE_REPO || undefined,
  }
}

/**
 * Whether per-company Railway provisioning is enabled + fully configured. When this
 * is false the module is INERT: ensureCompanyService() returns { ok:false,
 * reason:'disabled' } WITHOUT touching Railway, so no cost is ever incurred by
 * default (tests, preview, or any env that hasn't explicitly opted in + supplied a
 * source + token). This is the primary cost guard.
 */
export function railwayDeployEnabled(): boolean {
  if (process.env.RAILWAY_DEPLOY_ENABLED !== 'true') return false
  if (!railwayToken()) return false
  if (!companyProjectId()) return false
  const src = companySource()
  if (!src.image && !src.repo) return false
  return true
}

export interface CompanyServiceResult {
  ok: boolean
  /** The created Railway service id — persist this to make future verifies idempotent. */
  serviceId?: string
  /** The public https URL the company app is served at (its *.up.railway.app domain). */
  url?: string
  /** The Railway domain (host only, no scheme) — handy for #240 CNAME targets. */
  domain?: string
  environmentId?: string
  reason?: string
  status?: number
}

/** Execute a Railway GraphQL operation. Throws on transport/GraphQL error. */
async function railwayQuery(
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<any> {
  const token = railwayToken()
  const res = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`railway non-json (${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`railway http ${res.status}: ${text.slice(0, 200)}`)
  }
  if (json.errors) {
    throw new Error(`railway graphql: ${JSON.stringify(json.errors).slice(0, 300)}`)
  }
  return json.data
}

/** Deterministic Railway service name for a company slug (idempotency aid + human-readable). */
export function serviceNameForSlug(slug: string): string {
  const safe = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase()
  return `company-${safe}`
}

/**
 * Look up an existing company service by its deterministic name in the shared
 * project. Lets us recover idempotency even if the registry write was lost after a
 * serviceCreate (so we never create a duplicate billable service). Returns the
 * serviceId or null. Best-effort: returns null on any error.
 */
export async function findCompanyService(slug: string): Promise<string | null> {
  if (!railwayDeployEnabled()) return null
  const name = serviceNameForSlug(slug)
  try {
    const data = await railwayQuery(
      `query Project($id: String!) {
        project(id: $id) {
          services { edges { node { id name } } }
        }
      }`,
      { id: companyProjectId() },
      20000,
    )
    const edges = data?.project?.services?.edges || []
    const hit = edges.find((e: any) => e?.node?.name === name)
    return hit?.node?.id || null
  } catch {
    return null
  }
}

/**
 * Provision (or reuse) a dedicated Railway service for a company (#243).
 *
 * PRECONDITIONS the caller MUST guarantee:
 *  - payment is verified (this is only ever reached post-payment), AND
 *  - the company has NO persisted railwayServiceId (idempotency handled by caller).
 *
 * Behaviour:
 *  - If disabled/unconfigured → { ok:false, reason:'disabled' } and NO API calls (cost-safe).
 *  - Else: reuse an existing same-named service if present (idempotency backstop),
 *    otherwise serviceCreate from the shared source, then create a domain, and return
 *    the serviceId + url so the caller can persist them.
 *
 * @param slug             company brand slug (also drives the service name + domain)
 * @param zerodbProjectId  the company's Instant DB project id, injected as a service var
 */
export async function ensureCompanyService(
  slug: string,
  zerodbProjectId?: string,
): Promise<CompanyServiceResult> {
  if (!railwayDeployEnabled()) {
    return { ok: false, reason: 'disabled' }
  }
  const safeSlug = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase()
  if (!safeSlug) return { ok: false, reason: 'bad_slug' }

  const projectId = companyProjectId()
  const envId = companyEnvironmentId()
  const src = companySource()
  const name = serviceNameForSlug(safeSlug)

  try {
    // Idempotency backstop: reuse a service already named for this slug rather than
    // ever creating a second billable one.
    let serviceId = await findCompanyService(safeSlug)

    if (!serviceId) {
      // Build the serviceCreate source input. Docker image takes precedence.
      const source: Record<string, unknown> = src.image
        ? { image: src.image }
        : { repo: src.repo }

      // Per-company variables so one shared image serves any company: its own data
      // layer (Instant DB project) + slug for host-based branding.
      const variables: Record<string, string> = {
        COMPANY_SLUG: safeSlug,
      }
      if (zerodbProjectId) variables.ZERODB_PROJECT_ID = zerodbProjectId

      const created = await railwayQuery(
        `mutation ServiceCreate($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }`,
        {
          input: {
            projectId,
            name,
            source,
            variables,
            ...(envId ? { environmentId: envId } : {}),
          },
        },
      )
      serviceId = created?.serviceCreate?.id
      if (!serviceId) return { ok: false, reason: 'service_create_no_id' }
    }

    // Mint a public Railway domain so the app is reachable + CNAME-able (#240).
    const domainResult = await createServiceDomain(serviceId, envId)

    return {
      ok: true,
      serviceId,
      environmentId: envId || undefined,
      url: domainResult.domain ? `https://${domainResult.domain}` : undefined,
      domain: domainResult.domain,
    }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }
}

// ---------------------------------------------------------------------------
// Bring-your-own custom domain (#53) — connect a domain the founder already owns.
//
// Flow (only ever reached for a PROVISIONED per-company Railway service, whose
// *.up.railway.app service domain is CNAME-pointable per #240):
//   1. customDomainCreate — register the founder's domain on the service. Railway
//      returns the exact DNS records to add at THEIR registrar: a CNAME → the
//      service's *.up.railway.app host, plus a `_railway-verify` TXT for cert
//      ownership. The customDomain has a `status` we surface honestly.
//   2. The founder adds those records at their registrar.
//   3. We poll: DNS propagation first (DoH), then Railway's cert status. TLS is
//      issued asynchronously (minutes → ~1h). We NEVER report "live" until Railway
//      says the cert is active — a resolving CNAME with no cert yet is `verifying`,
//      not done (see the ainative-dns skill: HTTPS `000` = cert still issuing).
//
// All functions are best-effort + cost-safe: they return structured results and
// never throw into the caller, and are inert (reason:'disabled') when Railway
// provisioning isn't enabled+configured.
// ---------------------------------------------------------------------------

/** A DNS record the founder must add at their registrar to wire a custom domain. */
export interface CustomDomainDnsRecord {
  /** 'CNAME' | 'TXT' | 'A' | 'ALIAS' — the record type to create. */
  type: string
  /** The record host/name, e.g. 'app' or '@' or '_railway-verify.app'. */
  name: string
  /** The value the record must point at (the *.up.railway.app host, or verify token). */
  value: string
  /** Railway's per-record status when known (e.g. 'PROPAGATED' / 'WAITING'). */
  status?: string
}

/** Honest lifecycle of a bring-your-own custom domain. Never jump to 'live' early. */
export type CustomDomainStatus = 'pending' | 'verifying' | 'live' | 'error'

export interface CustomDomainResult {
  ok: boolean
  /** The Railway customDomain id (persist to make status polls / re-opens idempotent). */
  id?: string
  /** The founder's domain (host only), e.g. 'myco.com'. */
  domain?: string
  /** Honest status: pending (records not detected) → verifying (DNS seen, cert issuing) → live (TLS active). */
  status?: CustomDomainStatus
  /** Exact DNS records the founder must add at their registrar. */
  dnsRecords?: CustomDomainDnsRecord[]
  /** The CNAME target host (the service's *.up.railway.app) for convenience. */
  cnameTarget?: string
  reason?: string
}

/** Normalise a user-typed domain to a bare host: strip scheme, path, port, trailing dot, lowercase. */
export function normalizeDomain(input: string): string {
  let d = String(input || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '')            // strip scheme
  d = d.replace(/\/.*$/, '')                    // strip path
  d = d.replace(/:\d+$/, '')                    // strip port
  d = d.replace(/\.$/, '')                      // strip trailing dot
  return d
}

/**
 * Validate a bring-your-own domain host. Accepts registrable domains and
 * subdomains (2+ labels, valid label charset, a TLD of ≥2 letters). Rejects
 * bare words, spaces, and obviously invalid input so we never send junk to Railway.
 */
export function isValidCustomDomain(input: string): boolean {
  const d = normalizeDomain(input)
  if (!d || d.length > 253) return false
  if (!d.includes('.')) return false
  const labels = d.split('.')
  if (labels.length < 2) return false
  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,}$/.test(tld)) return false
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))
}

/**
 * Map a Railway customDomain `status` (and cert state) to our honest lifecycle.
 * Railway's status strings vary by API version; we treat anything cert-active as
 * 'live', a seen-but-not-certed domain as 'verifying', and an unseen domain as
 * 'pending'. Defensive: unknown → 'verifying' (never a false 'live').
 */
export function mapCustomDomainStatus(raw: {
  status?: string | null
  certificateStatus?: string | null
  cdnProviderStatus?: string | null
  dnsRecords?: Array<{ status?: string | null }>
}): CustomDomainStatus {
  const s = String(raw?.status || '').toUpperCase()
  const cert = String(raw?.certificateStatus || '').toUpperCase()
  // Cert active anywhere → live.
  if (cert === 'ISSUED' || cert === 'ACTIVE' || s === 'ACTIVE' || s === 'LIVE') return 'live'
  if (s === 'ERROR' || s === 'FAILED' || cert === 'ERROR' || cert === 'FAILED') return 'error'
  // DNS records all propagated but cert not yet issued → verifying.
  const recs = raw?.dnsRecords || []
  const allSeen = recs.length > 0 && recs.every((r) => {
    const rs = String(r?.status || '').toUpperCase()
    return rs === 'PROPAGATED' || rs === 'VALID' || rs === 'RESOLVED'
  })
  if (allSeen || s === 'WAITING_CERTIFICATE' || cert === 'ISSUING' || cert === 'PENDING') return 'verifying'
  // Records not yet detected → pending.
  return 'pending'
}

/** Shape Railway's returned dnsRecords into our founder-facing record list. */
function shapeDnsRecords(
  raw: Array<Record<string, any>> | undefined,
  fallbackCname?: string,
  domain?: string,
): CustomDomainDnsRecord[] {
  const out: CustomDomainDnsRecord[] = []
  for (const r of raw || []) {
    const type = String(r?.recordType || r?.type || '').toUpperCase()
    const name = String(r?.hostlabel ?? r?.fqdn ?? r?.name ?? domain ?? '')
    const value = String(r?.requiredValue ?? r?.value ?? '')
    if (!type || !value) continue
    out.push({ type, name, value, status: r?.status ? String(r.status) : undefined })
  }
  // Defensive fallback: if Railway returned no records but we know the service
  // host, still tell the founder the CNAME to add (better than a blank panel).
  if (out.length === 0 && fallbackCname && domain) {
    out.push({ type: 'CNAME', name: domain, value: fallbackCname })
  }
  return out
}

/**
 * Register a founder's own domain on a provisioned company's Railway service (#53),
 * returning the exact DNS records they must add + the initial status. Idempotent:
 * if the domain is already attached Railway returns the existing record — we surface
 * its current status rather than erroring.
 *
 * @param serviceId    the company's dedicated Railway service id (must exist — BYO is
 *                     only offered for provisioned companies, which are CNAME-pointable).
 * @param domain       the founder's domain (e.g. 'myco.com'); normalised + validated here.
 * @param cnameTarget  the service's *.up.railway.app host, used as the CNAME fallback.
 */
export async function createCustomDomain(
  serviceId: string,
  domain: string,
  environmentId?: string,
  cnameTarget?: string,
): Promise<CustomDomainResult> {
  if (!railwayDeployEnabled()) return { ok: false, reason: 'disabled' }
  if (!serviceId) return { ok: false, reason: 'no_service' }
  const host = normalizeDomain(domain)
  if (!isValidCustomDomain(host)) return { ok: false, reason: 'bad_domain' }
  const envId = environmentId || companyEnvironmentId()
  if (!envId) return { ok: false, reason: 'no_environment' }

  try {
    const created = await railwayQuery(
      `mutation CustomDomainCreate($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          status
          certificateStatus
          dnsRecords { hostlabel fqdn recordType requiredValue currentValue status zone }
        }
      }`,
      { input: { serviceId, environmentId: envId, domain: host } },
    )
    const cd = created?.customDomainCreate
    if (!cd?.id) return { ok: false, reason: 'create_no_id' }
    return {
      ok: true,
      id: cd.id,
      domain: cd.domain || host,
      status: mapCustomDomainStatus(cd),
      dnsRecords: shapeDnsRecords(cd.dnsRecords, cnameTarget, host),
      cnameTarget,
    }
  } catch (e: any) {
    const msg = String(e?.message || e)
    // A domain already registered on the service is not a failure — fall through to
    // a status read so re-connecting an already-connected domain is idempotent (#53).
    if (/already|exists|duplicate/i.test(msg)) {
      const status = await getCustomDomainStatus(serviceId, host, envId, cnameTarget)
      if (status.ok) return status
    }
    return { ok: false, reason: msg.slice(0, 200) }
  }
}

/**
 * Read the current status of a founder's custom domain on a service (#53). Used to
 * poll DNS/cert progress and to make re-opening the modal show an already-connected
 * domain's live status. Returns { ok:false, reason:'not_found' } if the domain isn't
 * attached (so the caller can offer to (re)connect it).
 */
export async function getCustomDomainStatus(
  serviceId: string,
  domain: string,
  environmentId?: string,
  cnameTarget?: string,
): Promise<CustomDomainResult> {
  if (!railwayDeployEnabled()) return { ok: false, reason: 'disabled' }
  if (!serviceId) return { ok: false, reason: 'no_service' }
  const host = normalizeDomain(domain)
  const envId = environmentId || companyEnvironmentId()
  if (!envId) return { ok: false, reason: 'no_environment' }

  try {
    const data = await railwayQuery(
      `query Domains($serviceId: String!, $environmentId: String!) {
        domains(serviceId: $serviceId, environmentId: $environmentId) {
          customDomains {
            id
            domain
            status
            certificateStatus
            dnsRecords { hostlabel fqdn recordType requiredValue currentValue status zone }
          }
        }
      }`,
      { serviceId, environmentId: envId },
      15000,
    )
    const list: any[] = data?.domains?.customDomains || []
    const cd = list.find((c) => normalizeDomain(String(c?.domain || '')) === host)
    if (!cd) return { ok: false, reason: 'not_found' }
    return {
      ok: true,
      id: cd.id,
      domain: cd.domain || host,
      status: mapCustomDomainStatus(cd),
      dnsRecords: shapeDnsRecords(cd.dnsRecords, cnameTarget, host),
      cnameTarget,
    }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }
}

/**
 * Best-effort DNS check via DNS-over-HTTPS (Google DoH) — has the founder's CNAME
 * (or A) started resolving toward the expected target? Used as a fast pre-check so
 * the UI can move from 'pending' → 'verifying' the moment DNS is seen, without
 * waiting on Railway. Returns false on any error (treat as "not yet"). Pure network,
 * no Railway token needed — safe to call even when Railway deploy is disabled.
 *
 * @param domain          the founder's domain to look up.
 * @param expectedTarget  substring the answer must contain (e.g. 'up.railway.app'
 *                        or the specific service host). Case-insensitive.
 */
export async function checkDnsRecord(
  domain: string,
  expectedTarget?: string,
): Promise<boolean> {
  const host = normalizeDomain(domain)
  if (!host) return false
  const dohBase = process.env.DNS_DOH_URL || 'https://dns.google/resolve'
  try {
    // Try CNAME first, then A — either resolving toward the target counts.
    for (const type of ['CNAME', 'A']) {
      const res = await fetch(`${dohBase}?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null)
      if (!res || !res.ok) continue
      const json: any = await res.json().catch(() => null)
      const answers: any[] = json?.Answer || []
      if (answers.length === 0) continue
      if (!expectedTarget) return true
      const want = expectedTarget.toLowerCase()
      if (answers.some((a) => String(a?.data || '').toLowerCase().includes(want))) return true
    }
    return false
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Deployment history + one-click rollback (#62) — per-service version history.
//
// Railway keeps a per-service deployment history: every push/redeploy is a
// `deployment` with an id, a status (SUCCESS/FAILED/BUILDING/…), a createdAt, and
// (for GitHub-sourced services) the git meta (commit SHA + message). We query
// that history to render a Versions list, and trigger `deploymentRedeploy` to
// roll a company's live site back to a chosen prior deployment.
//
// All functions here are best-effort + cost-safe: inert (reason:'disabled') when
// Railway provisioning isn't enabled+configured, and they return structured
// results rather than throwing into the caller.
// ---------------------------------------------------------------------------

/**
 * Honest lifecycle of a Railway deployment as it maps to our Versions UI:
 *  - live:      the currently-serving deployment (SUCCESS + newest active).
 *  - success:   a completed prior deployment (rollback target).
 *  - building:  build/deploy in flight (a fresh deploy or an in-progress rollback).
 *  - failed:    the deploy did not complete.
 *  - removed:   the deployment was removed/crashed and is not a valid target.
 */
export type DeploymentStatus = 'live' | 'success' | 'building' | 'failed' | 'removed'

/** A single Railway deployment, shaped for the Versions list. */
export interface RailwayDeployment {
  /** Railway deployment id — the rollback target (deploymentRedeploy(id)). */
  id: string
  /** Our normalized status. */
  status: DeploymentStatus
  /** Raw Railway status string (e.g. 'SUCCESS'), for debugging. */
  rawStatus?: string
  /** ISO created timestamp. */
  createdAt?: string
  /** Git commit SHA (short) when the service is GitHub-sourced. */
  commitSha?: string
  /** Commit / deploy message (Cody's summary of what changed). */
  message?: string
  /** True for the deployment currently serving the live site. */
  current?: boolean
}

/**
 * Map a raw Railway deployment status to our normalized lifecycle. Railway's
 * status enum: BUILDING, DEPLOYING, SUCCESS, FAILED, CRASHED, REMOVED, REMOVING,
 * INITIALIZING, QUEUED, SKIPPED, WAITING, NEEDS_APPROVAL. Defensive: unknown →
 * 'building' (never a false 'live'). Pure.
 */
export function mapDeploymentStatus(raw: string | null | undefined): DeploymentStatus {
  const s = String(raw || '').toUpperCase()
  if (s === 'SUCCESS') return 'success'
  if (s === 'FAILED' || s === 'CRASHED' || s === 'SKIPPED') return 'failed'
  if (s === 'REMOVED' || s === 'REMOVING') return 'removed'
  // BUILDING / DEPLOYING / INITIALIZING / QUEUED / WAITING / NEEDS_APPROVAL / …
  return 'building'
}

/**
 * Shape a raw Railway deployment node into our RailwayDeployment. The `current`
 * flag is NOT set here (it depends on the whole list — the newest SUCCESS is the
 * live one); callers use markCurrentDeployment() for that. Pure. Returns null for
 * a node with no id.
 */
export function shapeDeployment(node: any): RailwayDeployment | null {
  if (!node?.id) return null
  const meta = node.meta || node.deploymentMeta || {}
  // Railway exposes git meta under a few shapes across API versions.
  const sha = String(
    node.commitSha ?? meta.commitSha ?? meta.commit_sha ?? meta.commitHash ?? '',
  ).slice(0, 40)
  const message = String(
    node.commitMessage ?? meta.commitMessage ?? meta.commit_message ?? meta.message ?? '',
  ).slice(0, 300)
  return {
    id: String(node.id),
    status: mapDeploymentStatus(node.status),
    rawStatus: node.status ? String(node.status) : undefined,
    createdAt: node.createdAt ? String(node.createdAt) : undefined,
    commitSha: sha ? sha.slice(0, 12) : undefined,
    message: message || undefined,
  }
}

/**
 * Given deployments sorted newest-first, mark the live one: the FIRST (newest)
 * deployment whose status is 'success' is the one currently serving. Sets
 * `current:true` on exactly that entry (or none, if there is no successful
 * deploy yet). Non-mutating. Pure.
 */
export function markCurrentDeployment(deployments: RailwayDeployment[]): RailwayDeployment[] {
  const list = Array.isArray(deployments) ? deployments : []
  let marked = false
  return list.map((d) => {
    if (!marked && d.status === 'success') {
      marked = true
      return { ...d, status: 'live' as DeploymentStatus, current: true }
    }
    return { ...d, current: false }
  })
}

/**
 * Sort deployments newest-first by createdAt (ISO strings sort lexically). Pure &
 * non-mutating. Deployments with no createdAt sink to the bottom.
 */
export function sortDeploymentsNewestFirst(deployments: RailwayDeployment[]): RailwayDeployment[] {
  return [...(Array.isArray(deployments) ? deployments : [])].sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  )
}

/**
 * Is a deployment a valid rollback target? Only completed (success/live) prior
 * deployments can be rolled back to — never a failed/removed/building one, and
 * never the one already live. Pure.
 */
export function isRollbackTarget(d: RailwayDeployment | null | undefined): boolean {
  if (!d?.id) return false
  if (d.current) return false
  return d.status === 'success' || d.status === 'live'
}

export interface DeploymentsResult {
  ok: boolean
  deployments?: RailwayDeployment[]
  reason?: string
}

/**
 * List a service's Railway deployment history (#62), newest-first with the live
 * one flagged. Best-effort: returns { ok:false, reason:'disabled' } and NO fetch
 * when Railway isn't enabled+configured; { ok:false, reason } on any error. The
 * caller joins these with the persisted per-company version index (messages/SHAs).
 *
 * @param serviceId      the company's dedicated Railway service id.
 * @param environmentId  the environment to read deployments from (defaults to the
 *                       configured company environment).
 * @param limit          max deployments to return (defends payload size).
 */
export async function listDeployments(
  serviceId: string,
  environmentId?: string,
  limit = 20,
): Promise<DeploymentsResult> {
  if (!railwayDeployEnabled()) return { ok: false, reason: 'disabled' }
  if (!serviceId) return { ok: false, reason: 'no_service' }
  const envId = environmentId || companyEnvironmentId()
  const cap = Math.min(Math.max(1, limit), 50)
  try {
    const data = await railwayQuery(
      `query Deployments($serviceId: String!, $environmentId: String, $first: Int) {
        deployments(
          first: $first
          input: { serviceId: $serviceId, environmentId: $environmentId }
        ) {
          edges {
            node {
              id
              status
              createdAt
              meta
            }
          }
        }
      }`,
      { serviceId, environmentId: envId || null, first: cap },
      20000,
    )
    const edges: any[] = data?.deployments?.edges || []
    const shaped = edges
      .map((e) => shapeDeployment(e?.node))
      .filter((d): d is RailwayDeployment => d !== null)
    const sorted = sortDeploymentsNewestFirst(shaped)
    return { ok: true, deployments: markCurrentDeployment(sorted) }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }
}

export interface RedeployResult {
  ok: boolean
  /** The new/redeployed deployment id, when Railway returns one. */
  deploymentId?: string
  reason?: string
}

/**
 * Trigger a rollback (#62): redeploy a prior Railway deployment so it becomes the
 * live one again. Best-effort + cost-safe: inert when disabled, structured result
 * otherwise. The caller (the /api/build/versions POST) is responsible for the
 * confirmation + status polling (rolling back → validating → live via a health
 * check on the served URL).
 *
 * @param deploymentId  the id of the PRIOR deployment to redeploy (a valid
 *                      rollback target — see isRollbackTarget()).
 */
export async function redeployDeployment(deploymentId: string): Promise<RedeployResult> {
  if (!railwayDeployEnabled()) return { ok: false, reason: 'disabled' }
  if (!deploymentId) return { ok: false, reason: 'no_deployment' }
  try {
    const data = await railwayQuery(
      `mutation DeploymentRedeploy($id: String!) {
        deploymentRedeploy(id: $id) { id status }
      }`,
      { id: deploymentId },
      30000,
    )
    const redeployed = data?.deploymentRedeploy
    // Railway returns the (re)deployment; some API versions echo the same id,
    // others mint a new one. Either way, ok if the mutation returned a node.
    if (!redeployed?.id) return { ok: false, reason: 'redeploy_no_id' }
    return { ok: true, deploymentId: String(redeployed.id) }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e).slice(0, 200) }
  }
}

/**
 * Health-check a URL after a rollback: is the rolled-back site actually serving
 * (HTTP 2xx/3xx)? Used by the versions route to not declare "live" until the
 * redeployed site responds. Best-effort — returns false on any error/timeout.
 * Pure network, no Railway token needed.
 */
export async function checkDeployHealth(url: string, timeoutMs = 8000): Promise<boolean> {
  const u = String(url || '').trim()
  if (!/^https?:\/\//i.test(u)) return false
  try {
    const res = await fetch(u, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null)
    if (!res) return false
    return res.status >= 200 && res.status < 400
  } catch {
    return false
  }
}

/**
 * Create (or reuse) a *.up.railway.app domain for a service. Idempotent-ish: if the
 * service already has a service domain we return it rather than minting another.
 * Returns { domain } (host only) or {} if none could be created.
 */
export async function createServiceDomain(
  serviceId: string,
  environmentId?: string,
): Promise<{ domain?: string }> {
  const envId = environmentId || companyEnvironmentId()
  if (!serviceId) return {}
  // If no environment id is configured we cannot target the domain create; skip
  // rather than guess (the caller still gets the serviceId to persist).
  if (!envId) return {}

  try {
    // Reuse an existing service domain if one is already attached.
    const existing = await railwayQuery(
      `query Domains($serviceId: String!, $environmentId: String!) {
        domains(serviceId: $serviceId, environmentId: $environmentId) {
          serviceDomains { domain }
        }
      }`,
      { serviceId, environmentId: envId },
      15000,
    ).catch(() => null)
    const already = existing?.domains?.serviceDomains?.[0]?.domain
    if (already) return { domain: already }

    const created = await railwayQuery(
      `mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      { input: { serviceId, environmentId: envId } },
    )
    const domain = created?.serviceDomainCreate?.domain
    return domain ? { domain } : {}
  } catch {
    return {}
  }
}
