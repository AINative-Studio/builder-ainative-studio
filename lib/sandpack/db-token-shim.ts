/**
 * #1561 — the Sandpack equivalent of app/api/preview/[id]/route.ts's
 * dbTokenShim, for multi-file generated apps rendered through Sandpack.
 *
 * ROOT CAUSE this repairs: the generation prompt (lib/professional-prompt.ts)
 * tells every generated app to call relative URLs (`fetch('/api/db/todos',
 * ...)`), which is correct for the single-file Babel preview (served from
 * builder.ainative.studio, same origin as /api/db/*). A Sandpack preview
 * runs inside a genuinely DIFFERENT origin (the self-hosted bundler,
 * sandpack-bundler-production.up.railway.app in production) — a relative
 * `/api/db/todos` fetch from inside that iframe resolves against the
 * BUNDLER's origin, which has no such route, and 404s silently (confirmed
 * live on `silo-product`: "Create Silo" did nothing, no error, no network
 * call ever reached the parent frame).
 *
 * Unlike dbTokenShim (same-origin — only needs to ATTACH an auth header),
 * this shim must also REWRITE the URL to the real absolute origin before
 * attaching the header. The corresponding routes (app/api/db/[table]/
 * route.ts) must accept cross-origin requests from the Sandpack bundler's
 * origin (see lib/sandpack/cors.ts) or this fetch rewrite alone is not
 * enough — the browser will still block the response as a CORS violation.
 *
 * Returns a real ES MODULE source string (not an HTML <script> tag) — a
 * Sandpack file is compiled and executed as a module by the bundler, not
 * parsed out of an HTML string the way the single-file preview's injected
 * <script> is. Scope is intentionally the same path list dbTokenShim covers
 * for /api/db today; the other prefixes (/api/memory, /api/primitive/*,
 * etc.) are a documented fast-follow once this pattern is proven (#1561's
 * PR note) rather than widening this change's CORS/testing surface in one
 * pass.
 */
export function sandpackDbTokenShim(origin: string, token: string): string {
  if (!origin || !token) return 'export {}\n'
  return `// #1561 — auto-injected, rewrites this app's relative /api/db calls to
// the real Builder origin and attaches its per-company auth token. See
// lib/sandpack/db-token-shim.ts for the full root-cause writeup.
const __AINATIVE_ORIGIN__ = ${JSON.stringify(origin)};
const __AINATIVE_DB_TOKEN__ = ${JSON.stringify(token)};
const __ainativeOriginalFetch__ = window.fetch.bind(window);
window.fetch = function (input, init) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/api/db') === 0) {
      const absoluteUrl = __AINATIVE_ORIGIN__ + url;
      const nextInit = init || {};
      const headers = new Headers(nextInit.headers || (typeof input === 'object' && input.headers) || undefined);
      headers.set('x-ainative-db-token', __AINATIVE_DB_TOKEN__);
      return __ainativeOriginalFetch__(absoluteUrl, { ...nextInit, headers });
    }
  } catch (e) {
    // Fall through to the real fetch unmodified — a shim bug must never be
    // worse than no shim at all.
  }
  return __ainativeOriginalFetch__(input, init);
};
export {};
`
}
