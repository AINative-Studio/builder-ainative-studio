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
 *
 * #2135 follow-up: `chatId`, when provided, also makes this module fire ONE
 * deterministic visitor-tracking beacon on import (mirrors the mandatory
 * `fetch('/api/db/visitors', ...)` pageview primitive-catalog.ts instructs
 * every generated landing page to write — see that file's "VISITOR
 * TRACKING" block). Found live via code reading (no fix here — a prompt
 * instruction to an LLM is inherently probabilistic, and #2135's own thread
 * has 20+ confirmed real companies missing this call entirely): this gate
 * is doubly broken for every Sandpack-rendered company. (1) Compliance is
 * never guaranteed — it's just prose in the system prompt. (2) Even on the
 * rare generation that DOES include the call, the LLM writes `path:
 * window.location.pathname`, which inside a Sandpack iframe is the BUNDLER's
 * own origin/route (sandpack-bundler-production.up.railway.app, pinned in
 * components/chat/sandpack-preview.tsx), never `/api/preview/{chatId}`. Per
 * lib/build/visitor-metrics.ts's own doc comment, the shared ZeroDB project
 * (every real sampled company today — none has its own `zerodbProjectId`)
 * can ONLY attribute a pageview row to a company by matching its chatId as a
 * substring of the row's stored `path` — so even a "working" LLM-authored
 * beacon silently writes a row the founder's own VisitorsPanel can never
 * read back. Hardcoding `path: '/api/preview/' + chatId` here (known
 * server-side at mint time, not read from the iframe's own location) fixes
 * both gaps at once, deterministically, for every Sandpack-rendered company
 * — the same "platform-injected, not LLM-dependent" pattern this file
 * already uses for the /api/db auth rewrite above. Intentionally
 * unconditional (fires regardless of whether the app's own code also has a
 * working beacon): in the shared-project case this is safe by construction
 * (an LLM-authored call's `path` never contains the chatId there, so it
 * never lands as a counted row anyway — nothing to double-count against).
 * The only real double-count exposure is a FUTURE per-company-provisioned
 * project whose generation also happens to have a working beacon of its own
 * — a currently-empty set (see visitor-metrics.ts's doc comment) — flagged
 * here rather than silently risked.
 */
export function sandpackDbTokenShim(origin: string, token: string, chatId?: string): string {
  if (!origin || !token) return 'export {}\n'
  const visitorBeacon = chatId
    ? `
// #2135 — deterministic visitor-pageview beacon, platform-injected so it
// never depends on the generated app's own code having written one (see
// this file's doc comment for the full root-cause writeup).
try {
  __ainativeOriginalFetch__(__AINATIVE_ORIGIN__ + '/api/db/visitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ainative-db-token': __AINATIVE_DB_TOKEN__ },
    body: JSON.stringify({ path: '/api/preview/' + ${JSON.stringify(chatId)}, ts: new Date().toISOString() }),
  }).catch(function () {});
} catch (e) {
  // Best-effort — a beacon failure must never affect the real app.
}
`
    : ''
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
${visitorBeacon}export {};
`
}
