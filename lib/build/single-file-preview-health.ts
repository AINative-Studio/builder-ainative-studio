/**
 * Real-signal health check for the single-file `/api/preview/{id}` serving
 * path (#2226) — the path a company takes when it has no persisted `files`
 * map (`GET /api/generation/{id}/files` returns 404 `{files:null}` by design;
 * see that route's own doc comment). Roughly a third of a fresh showcase
 * sample lands here, and nothing in this repo previously checked it at all:
 * any `files`-map-based detector (e.g. a `checkRenderHealth`-style tool) has
 * no map to validate, so these companies were silently skipped rather than
 * confirmed clean or broken.
 *
 * #2222 found two superficially similar but very different signals in this
 * same route's raw HTML:
 *   - RELIABLE: `app/api/preview/[id]/route.ts` (~line 605-620) returns a
 *     small, fully-formed, non-React HTML document DIRECTLY — no bundle,
 *     no React — when `validateJavaScriptCode()` fails before any component
 *     code is ever sent to the browser. That document's own regenerate
 *     button carries `id="regen"`, and its heading is the literal string
 *     "This build needs another pass" (no trailing words). This is a server-
 *     side fact: if curl sees it, a real visitor's browser sees the exact
 *     same thing, no execution required.
 *   - UNRELIABLE: the route ALSO always embeds a client-side `ErrorBoundary`
 *     React component (~line 1390-1410) as literal JS source, present in
 *     EVERY single-file preview bundle whether or not that company is
 *     actually broken — it only renders if a runtime crash fires inside the
 *     browser. Its fallback copy ("Refining your app" / "...needs another
 *     pass to render cleanly") and its regenerate button (a
 *     `React.createElement('button', {key:'regenerate'})` call — no `id`
 *     attribute at all, since it's a JS object literal, not raw HTML) look
 *     similar but are textually distinct from the reliable signal above.
 *     Grepping raw HTML for this one proves nothing either way (confirmed:
 *     it matched 9/9 genuinely-200-and-otherwise-healthy companies in the
 *     sample that led to this module).
 *
 * This module only ever checks the RELIABLE signal. It makes no claim at
 * all when that signal is absent — the only honest statement a tool with no
 * real browser can make. It does not run a Babel/React bundle; it does not
 * mutate anything; it needs no credentials (the preview route is public).
 */

const RELIABLE_FAILURE_HEADING = '>This build needs another pass<'
const RELIABLE_FAILURE_REGEN_BUTTON = 'id="regen"'

export interface SingleFilePreviewHealth {
  /** True when the real server-side pre-validation failure page was served. */
  brokenServerSide: boolean
  /**
   * False means this HTML carries neither the reliable failure signal nor
   * any sign of a genuine rendered bundle — e.g. an empty or non-HTML
   * response. Still not proof of health; just that nothing conclusive
   * (good or bad) was found via this static check.
   */
  looksLikeRealBundle: boolean
}

/**
 * @param html Raw response body of `GET /api/preview/{chatId}`.
 */
export function checkSingleFilePreviewHealth(html: string | undefined | null): SingleFilePreviewHealth {
  if (!html) {
    return { brokenServerSide: false, looksLikeRealBundle: false }
  }

  const brokenServerSide =
    html.includes(RELIABLE_FAILURE_HEADING) && html.includes(RELIABLE_FAILURE_REGEN_BUTTON)

  // A real bundle response is a full HTML document with a script tag that
  // loads React (the same crossorigin unpkg.com React UMD build every
  // genuine single-file preview loads) — present whether or not the
  // component code inside it later throws at runtime. Absence of this is
  // itself a signal worth surfacing (e.g. a non-200, or a totally different
  // kind of error page this module doesn't yet know about).
  const looksLikeRealBundle = !brokenServerSide && /react(-dom)?@18\/umd\/react/.test(html)

  return { brokenServerSide, looksLikeRealBundle }
}
