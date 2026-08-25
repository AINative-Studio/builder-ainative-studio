/**
 * Persistent-hosting deploy seam (#243).
 *
 * A company shipped from /build renders today via the durable sandbox preview
 * (/build/{slug} → the preview store, persisted in ZeroDB). That IS durable and
 * shareable, but it is NOT a dedicated per-company host: it lives under the
 * shared builder origin and cannot take a custom-domain A/CNAME record — #240's
 * DNS therefore points a purchased domain at the app via a 301 URL redirect.
 *
 * This module is the SEAM where real persistent hosting plugs in. When a shared
 * *.ainative.studio wildcard host is configured (AINATIVE_WILDCARD_HOST), a company
 * gets a REAL dedicated, DNS-pointable host at {slug}.ainative.studio — served by the
 * Builder itself via host→slug rewriting in middleware (no per-company service to
 * provision). #240's DNS can then CNAME a custom domain → {slug}.ainative.studio
 * instead of a 301 redirect. Absent that env, it falls back to the durable preview
 * URL (still real + shareable, just not CNAME-pointable).
 *
 * A per-company Railway service is the second, heavier option (own backend). It is
 * now implemented in lib/build/railway-deploy.ts and driven from deployRailwayService()
 * below — but it fires ONLY on a VERIFIED PAID subscription (the verify route calls
 * it), and ONLY when RAILWAY_DEPLOY_ENABLED + a source + token are configured, because
 * a dedicated service is real, billable hosting. It is idempotent: it never creates a
 * second service for a company that already has a railwayServiceId.
 *
 * See docs/PERSISTENT_DEPLOY_ARCHITECTURE.md for the target architecture.
 */

import {
  ensureCompanyService,
  railwayDeployEnabled,
  type CompanyServiceResult,
} from './railway-deploy'

// Re-export so callers (e.g. the verify route) can gate on the cost switch without
// importing railway-deploy directly — deploy.ts stays the single deploy entrypoint.
export { railwayDeployEnabled }

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

/** The shared wildcard apex, e.g. "ainative.studio". When set, companies get a real
 *  {slug}.<host> address served by host→slug rewrite in middleware.ts. */
export const WILDCARD_HOST = process.env.AINATIVE_WILDCARD_HOST || ''

/** The public {slug}.<wildcard> URL for a company, or null if no wildcard host is
 *  configured. Kept here so middleware + DNS wiring share one definition. */
export function wildcardUrl(slug: string): string | null {
  if (!WILDCARD_HOST) return null
  const safe = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase()
  return safe ? `https://${safe}.${WILDCARD_HOST}` : null
}

/**
 * Reserved subdomains that are NEVER company slugs — our own hosts + common infra
 * labels. Since companies live on the apex ({slug}.ainative.studio) behind a
 * wildcard, and the *.ainative.studio wildcard routes to the Builder service, we
 * must NEVER rewrite a request for an EXISTING sibling app (zerodb./docs./chat./…)
 * into /build/{that}. Explicit DNS records already take precedence over the
 * wildcard, so those apps keep resolving to their own services — this set is the
 * defense-in-depth guard in case any such Host ever reaches the Builder.
 *
 * The bulk of this list is SYNCED from the real ainative.studio Netlify DNS zone
 * (every first-label subdomain with an explicit A/CNAME/ALIAS/NETLIFY record as of
 * 2026-08-21), plus common infra labels. When you stand up a new *.ainative.studio
 * host, add its label here too. To re-sync: list the zone's records and take every
 * single-label host record name.
 */
export const RESERVED_SUBDOMAINS = new Set([
  // Generic infra / common labels (not necessarily in DNS, but must never be slugs).
  'www', 'app', 'apps', 'admin', 'staging', 'test', 'mail', 'email', 'blog',
  'status', 'cdn', 'assets', 'static', 'auth', 'login', 'dashboard', 'agents',
  'zerocommerce', 'zeromemory', 'zerovoice',
  // Synced from the live ainative.studio Netlify DNS zone (existing apps — 2026-08-21).
  'acquireos', 'agency', 'agent402', 'agentflow', 'aikit', 'api', 'blaq',
  'boardlens', 'build', 'builder', 'buildos', 'chat', 'community', 'dealer',
  'dealership-api', 'dev', 'docs', 'dothack', 'draftline', 'foundersapi', 'hack',
  'helpdesk', 'insurance-agent', 'live', 'memory', 'mif', 'ngo', 'ocean',
  'oceanapi', 'pillsense', 'pipeline', 'properstack', 'publicfounders', 'qnn',
  'qui', 'sc-builders', 'specbook', 'surgeonmatch', 'winning-careers', 'wwmaa',
  'zerodb', 'zeroinvoice', 'zeropipeline', 'zerowarranty',
])

/**
 * Extract a company slug from an incoming request Host header for the wildcard
 * host (#243). Returns the slug for `{slug}.<wildcardHost>`, or null when the host
 * isn't a company subdomain (apex, a reserved/infra subdomain like builder./api.,
 * a multi-label subdomain, a different host, or no wildcard configured). Pure +
 * host-only (port stripped) so middleware can rewrite {slug}.ainative.studio →
 * /build/{slug} and this stays unit-testable.
 */
export function wildcardSlugFromHost(host: string | null, wildcardHost = WILDCARD_HOST): string | null {
  if (!wildcardHost || !host) return null
  const h = host.toLowerCase().split(':')[0]
  const suffix = `.${wildcardHost.toLowerCase()}`
  if (!h.endsWith(suffix)) return null
  const sub = h.slice(0, -suffix.length)
  // Must be a single-label, non-reserved subdomain matching the slug charset.
  if (!sub || sub.includes('.') || !/^[a-z0-9_-]+$/.test(sub)) return null
  if (RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

/**
 * Paid subscription plan ids (#78) — a company must be on one of these before its
 * subdomain may resolve. Mirrors the ActivePlan paid tiers used across the build UI
 * (pro|business|enterprise|cody_vcto); the empty string / undefined is unpaid.
 */
export const PAID_PLANS = new Set(['pro', 'business', 'enterprise', 'cody_vcto'])

/** True when a plan id is a real paid subscription tier (#78). */
export function isPaidPlan(plan: string | null | undefined): boolean {
  return !!plan && PAID_PLANS.has(String(plan).toLowerCase())
}

/**
 * Product rule (#78): a company's {slug}.ainative.studio subdomain must NOT resolve
 * until the company is on a PAID plan AND has explicitly CLAIMED the subdomain. This
 * is the single, pure gate the edge middleware consults after extracting a slug — it
 * takes the minimal shape of the resolved AppEntry (plan + subdomainClaimed) and
 * returns true ONLY when both conditions hold. A null entry (unregistered / lookup
 * failed upstream) is NOT servable — fail-safe: the caller redirects to /build/{slug}.
 */
export function subdomainServable(
  entry: { plan?: string | null; subdomainClaimed?: boolean } | null | undefined,
): boolean {
  if (!entry) return false
  return isPaidPlan(entry.plan) && entry.subdomainClaimed === true
}

export interface DeployTarget {
  /** The public URL the company app is served at right now. */
  url: string
  /** How the app is hosted: 'preview' = durable sandbox (current), 'railway'/'wildcard' = real persistent host (future). */
  kind: 'preview' | 'railway' | 'wildcard'
  /**
   * Whether this URL can accept a DNS A/CNAME record for a custom domain.
   * The durable preview cannot (it's a subdirectory on the shared origin), so
   * #240 uses a 301 redirect until a real host lands here.
   */
  dnsPointable: boolean
}

/**
 * Resolve the persistent hosting target for a company's app.
 *
 * Real wildcard host (when AINATIVE_WILDCARD_HOST is set): returns
 * https://{slug}.ainative.studio — a dedicated, DNS-pointable address served by the
 * Builder via host→slug rewrite in middleware.ts. No per-company service is
 * created; it's the same app content, addressed at its own host. `dnsPointable`
 * is true, so #240 can CNAME a custom domain → {slug}.ainative.studio.
 *
 * Fallback (no wildcard env): the durable preview URL at /build/{slug} — a real,
 * persistent, shareable URL backed by the ZeroDB preview store, but a subdirectory
 * on the shared origin, so not CNAME-pointable (#240 uses a 301 redirect there).
 *
 * A per-company Railway service (own backend at {slug}.up.railway.app) remains a
 * heavier future option; headless service-create isn't safely automatable here, so
 * it's left as the documented seam below.
 */
export async function deployPersistent(
  chatId: string,
  slug: string,
  // #80: the wildcard subdomain URL must only be surfaced when the company is
  // PAID + has CLAIMED the subdomain (same gate #78 enforces in middleware).
  // Without the entry (or when not paid+claimed), return the /build/{slug} path —
  // otherwise we'd hand back a {slug}.ainative.studio URL that #78 just 301s away.
  entry?: { plan?: string; subdomainClaimed?: boolean } | null,
): Promise<DeployTarget> {
  const safeSlug = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)

  // --- Real persistent host: shared *.ainative.studio wildcard --------------
  // Served by middleware host→slug rewrite — a real dedicated host per company
  // with no provisioning step, and CNAME-pointable for custom domains (#240).
  // GATED (#78/#80): only when the company is paid + has claimed the subdomain.
  const wc = wildcardUrl(safeSlug)
  if (wc && subdomainServable(entry)) {
    return { url: wc, kind: 'wildcard', dnsPointable: true }
  }

  // NOTE: the per-company Railway service (kind:'railway') is a SEPARATE, PAID-only
  // path — deployRailwayService() below — NOT resolved here. deployPersistent() is
  // called on free/anonymous paths too (register-app, provision), so it must never
  // create billable hosting. The Railway service is created ONLY by the verify route
  // after payment is confirmed.

  // --- Fallback durable target: durable preview subdirectory -------------
  return {
    url: `${APP}/build/${safeSlug}`,
    kind: 'preview',
    dnsPointable: false,
  }
}

/** What the caller must already know about a company to (idempotently) deploy it. */
export interface RailwayDeployInput {
  slug: string
  /** The company's Instant DB project id — injected into the service as a variable. */
  zerodbProjectId?: string
  /** Persisted Railway service id, if this company was already deployed. Presence of
   *  this SKIPS creation (idempotency): we never create a second billable service. */
  existingServiceId?: string
  /** The company's already-known deploy URL (e.g. from a prior Railway deploy). */
  existingUrl?: string
}

export interface RailwayDeployResult {
  /** 'created' = a new service was provisioned; 'existing' = reused the persisted one;
   *  'skipped' = disabled/not-configured (no cost); 'error' = provisioning failed. */
  status: 'created' | 'existing' | 'skipped' | 'error'
  serviceId?: string
  url?: string
  domain?: string
  reason?: string
}

/**
 * Provision a dedicated per-company Railway service (#243) — the heavy, PAID-only
 * persistent host with its own backend, bindable to a custom domain (#240).
 *
 * TRIGGER CONTRACT: call this ONLY after a subscription payment has been verified
 * server-side (the verify route does exactly this). It is NOT called from the free /
 * anonymous provision or register-app paths — those use deployPersistent() (durable
 * preview / wildcard), which never incurs hosting cost.
 *
 * IDEMPOTENCY: if `existingServiceId` is set, this returns { status:'existing' }
 * WITHOUT any Railway API call, so re-running verify for an already-deployed company
 * never creates a second (billable) service. The registry is the source of truth for
 * existingServiceId; a name-based backstop inside ensureCompanyService() catches the
 * rare case where a create succeeded but the registry write was lost.
 *
 * COST SAFETY: if Railway deploy isn't enabled+configured (railwayDeployEnabled()),
 * this is inert and returns { status:'skipped' } with no API call.
 */
export async function deployRailwayService(
  input: RailwayDeployInput,
): Promise<RailwayDeployResult> {
  const slug = String(input.slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase()
  if (!slug) return { status: 'error', reason: 'bad_slug' }

  // Idempotency: already has a dedicated service → reuse, no API call, no new cost.
  if (input.existingServiceId) {
    return { status: 'existing', serviceId: input.existingServiceId, url: input.existingUrl }
  }

  // Cost guard: only ever hit Railway when explicitly enabled + configured.
  if (!railwayDeployEnabled()) {
    return { status: 'skipped', reason: 'disabled' }
  }

  const res: CompanyServiceResult = await ensureCompanyService(slug, input.zerodbProjectId)
  if (!res.ok || !res.serviceId) {
    return { status: 'error', reason: res.reason || 'ensure_failed' }
  }
  return {
    status: 'created',
    serviceId: res.serviceId,
    url: res.url,
    domain: res.domain,
  }
}
