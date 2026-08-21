/**
 * Persistent-hosting deploy seam (#243).
 *
 * A company shipped from /build renders today via the durable sandbox preview
 * (/build/{slug} → the preview store, persisted in ZeroDB). That IS durable and
 * shareable, but it is NOT a dedicated per-company host: it lives under the
 * shared builder origin and cannot take a custom-domain A/CNAME record — #240's
 * DNS therefore points a purchased domain at the app via a 301 URL redirect.
 *
 * This module is the SEAM where real persistent hosting plugs in. `deployPersistent`
 * today returns the durable preview URL (so callers get a real, working target),
 * and is TODO-marked to swap in a Railway service (or a shared *.ainative.app
 * wildcard host with host→slug routing) once that is safely automatable headlessly.
 *
 * See docs/PERSISTENT_DEPLOY_ARCHITECTURE.md for the target architecture and how
 * #240's DNS switches from URL301 → A/CNAME once a real host exists.
 */

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'

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
 * MVP (real, today): returns the durable preview URL at /build/{slug}. This is
 * a real, persistent, shareable URL backed by the ZeroDB-persisted preview store
 * — it survives restarts and is what Live already links to.
 *
 * TODO(#243): swap in a real dedicated host. Two candidate targets (see the
 * design doc): (a) a Railway service per company at {slug}.up.railway.app, or
 * (b) a shared *.ainative.app wildcard host with host→slug routing in Builder
 * middleware serving {slug}.ainative.app. Either makes `dnsPointable` true so
 * #240 can point a custom domain via CNAME instead of a 301 redirect.
 */
export async function deployPersistent(
  chatId: string,
  slug: string,
): Promise<DeployTarget> {
  const safeSlug = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40)

  // --- Real persistent host (future) -------------------------------------
  // When RAILWAY_DEPLOY_ENABLED (or a wildcard host env) is configured, this is
  // where we would create/ensure the per-company Railway service and return its
  // URL. Left as a documented no-op so the seam is explicit and testable.
  //
  // if (process.env.AINATIVE_WILDCARD_HOST) {
  //   return { url: `https://${safeSlug}.${process.env.AINATIVE_WILDCARD_HOST}`, kind: 'wildcard', dnsPointable: true }
  // }
  // if (process.env.RAILWAY_DEPLOY_ENABLED === 'true') {
  //   const svc = await ensureRailwayService(safeSlug, chatId)  // TODO: implement headless provisioner
  //   return { url: svc.url, kind: 'railway', dnsPointable: true }
  // }

  // --- MVP durable target (current) --------------------------------------
  return {
    url: `${APP}/build/${safeSlug}`,
    kind: 'preview',
    dnsPointable: false,
  }
}
