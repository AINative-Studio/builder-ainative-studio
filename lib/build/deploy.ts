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
 * A per-company Railway service remains a second, heavier option (own backend),
 * left as a documented seam below since headless service-create isn't safe here.
 *
 * See docs/PERSISTENT_DEPLOY_ARCHITECTURE.md for the target architecture.
 */

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
 * labels. Since companies live on the apex ({slug}.ainative.studio), we must not
 * let a request to builder./api./docs./www. get rewritten to /build/{that}.
 * Keep in sync with any new *.ainative.studio hosts we stand up.
 */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'builder', 'api', 'docs', 'app', 'apps', 'admin', 'staging', 'dev',
  'test', 'mail', 'email', 'blog', 'status', 'cdn', 'assets', 'static', 'auth',
  'login', 'dashboard', 'pipeline', 'zerocommerce', 'zerodb', 'memory', 'agents',
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
): Promise<DeployTarget> {
  const safeSlug = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)

  // --- Real persistent host: shared *.ainative.studio wildcard --------------
  // Served by middleware host→slug rewrite — a real dedicated host per company
  // with no provisioning step, and CNAME-pointable for custom domains (#240).
  const wc = wildcardUrl(safeSlug)
  if (wc) {
    return { url: wc, kind: 'wildcard', dnsPointable: true }
  }

  // --- Heavier future option: per-company Railway service ----------------
  // if (process.env.RAILWAY_DEPLOY_ENABLED === 'true') {
  //   const svc = await ensureRailwayService(safeSlug, chatId)  // TODO: headless provisioner
  //   return { url: svc.url, kind: 'railway', dnsPointable: true }
  // }

  // --- Fallback durable target: durable preview subdirectory -------------
  return {
    url: `${APP}/build/${safeSlug}`,
    kind: 'preview',
    dnsPointable: false,
  }
}
