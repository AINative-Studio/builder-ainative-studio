/**
 * Internal (server-to-server) base URL for a self-referential fetch() from
 * one of this service's own route handlers back into itself — e.g.
 * company-app/route.ts and company-product/route.ts detached-generation
 * handlers calling /api/chat-ws on the same Railway service.
 *
 * Real bug, found twice independently (#1110/#1111, and again live
 * 2026-10-21 for company-app/company-product's landing-page/product
 * generation): calling the service's own PUBLIC domain (request.url's
 * origin, or NEXT_PUBLIC_APP_URL) from a server-side fetch() can fail —
 * #1110's confirmed case was a bare "fetch failed" on every call, this
 * route's case (confirmed live: zero deployment-health stages ever
 * recorded, meaning the detached generation never even reached its first
 * `await fetch(...)` far enough to respond) is consistent with the same
 * self-referential-round-trip-through-the-public-edge failure mode. The
 * request/response never fully completing server-to-server through
 * Railway's public edge is the unreliable part, not the route's own logic.
 *
 * Fix (proven in #1110/#1111): call Railway's private internal network
 * (RAILWAY_PRIVATE_DOMAIN) instead, bypassing the public edge entirely for
 * this server-to-server hop. Falls back to the public origin when the
 * private domain isn't set (local dev, tests, non-Railway environments).
 */
export function internalBaseUrl(requestUrl: string): string {
  const privateDomain = process.env.RAILWAY_PRIVATE_DOMAIN
  if (privateDomain) {
    const port = process.env.PORT || '3000'
    return `http://${privateDomain}:${port}`
  }
  return process.env.NEXT_PUBLIC_APP_URL || new URL(requestUrl).origin
}
