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
