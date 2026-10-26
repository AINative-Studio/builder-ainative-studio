/**
 * #1561 — CORS origin matching for the Sandpack bundler's cross-origin
 * /api/db calls.
 *
 * Sandpack (both the stock CodeSandbox bundler and AINative's own
 * self-hosted fork — see components/chat/sandpack-preview.tsx's doc comment
 * on SANDPACK_BUNDLER_URL) serves each live preview from a PER-SANDBOX
 * subdomain of its base bundler host, not the bare bundler origin itself
 * (confirmed by that same file's own reference to the self-hosted fork's
 * `https://sandpack{{suffix}}.ainative.studio/` placeholder — `{{suffix}}`
 * is a per-sandbox id the bundler fills in at serve time). A single exact-
 * match CORS origin would therefore reject every real preview's actual
 * `Origin` header.
 *
 * isAllowedSandpackOrigin reflects this: an origin is allowed only when its
 * hostname IS the bundler's base host, or a dot-subdomain of it — never a
 * bare substring match (an attacker-controlled
 * "evil.com/sandpack-bundler-production.up.railway.app" would otherwise
 * pass a naive `.includes()` check). Parsed via the real URL API so a
 * malformed Origin header fails closed (returns false) rather than throwing
 * or matching unexpectedly.
 */
export function isAllowedSandpackOrigin(origin: string | null, bundlerBaseUrl: string): boolean {
  if (!origin || !bundlerBaseUrl) return false
  let originHost: string
  let bundlerHost: string
  try {
    originHost = new URL(origin).hostname.toLowerCase()
    bundlerHost = new URL(bundlerBaseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!bundlerHost) return false
  return originHost === bundlerHost || originHost.endsWith(`.${bundlerHost}`)
}

/**
 * CORS response headers for a request whose Origin has already been
 * confirmed allowed (via isAllowedSandpackOrigin) — reflects that exact
 * origin back (never `*`, which would also have to drop credentials and
 * defeats the per-company token-scoping this whole proxy exists for) plus
 * the specific header the Sandpack db-token-shim sends.
 */
export function sandpackCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-ainative-db-token, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
