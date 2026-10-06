/**
 * Unsubstituted-template-placeholder guard (builder#960).
 *
 * Deliberately its own tiny module with ZERO imports: it is used both by the
 * client-side deep-link entry point (contexts/build-context.tsx) and by the
 * server-side showcase read path (app/api/showcase/route.ts via
 * lib/showcase-data.ts). Putting it in showcase-data.ts directly would pull
 * that module's whole SEED_SHOWCASE payload into the client bundle for the sake
 * of one regex.
 */

/**
 * Does this string look like an UNSUBSTITUTED documentation placeholder rather
 * than a real founder-supplied company name or idea?
 *
 * Real bug found live, root-caused by exact byte-for-byte reproduction
 * (2026-10-06): two public showcase entries were titled, literally, `{slug}`
 * plus a trailing backtick. The origin was NOT a server-side template-literal
 * bug — every `${slug}` in app/api/build interpolates correctly — but the
 * deep-link entry point in contexts/build-context.tsx, which seeds `idea`,
 * `appSub` AND `companyName` from the RAW `?company=` query param. Someone
 * opened `/build?screen=live&company={slug}` with the markdown code-span's
 * closing backtick included, from a URL copied verbatim out of this repo's own
 * docs (docs/growth/WINBACK_EMAIL_2026-08-27.md line 23 literally contains
 * `?screen=live&company={slug}` inside backticks; so does
 * components/build/StandalonePreviewRegenerate.tsx's doc comment). That raw
 * value became `state.companyName` AND `state.idea`, which Live.tsx posted as
 * `name`/`idea` to BOTH /api/build/company-app and /api/build/company-product
 * — producing exactly the two live garbage generations, one per template.
 *
 * Deliberately NARROW. Only flags:
 *   - `{...}` / `${...}` brace-delimited template syntax, which no real company
 *     name or founder-written idea contains.
 *   - a stray backtick, the markdown code-span delimiter that rides along when
 *     a placeholder URL is copied out of documentation.
 *
 * Real founder ideas legitimately contain parentheses, quotes, apostrophes,
 * hyphens, slashes, ampersands and ordinary punctuation — none of those are
 * flagged, so this cannot reject a real build.
 */
export function looksLikeUnsubstitutedPlaceholder(value: string | null | undefined): boolean {
  const s = (value || '').trim()
  if (!s) return false
  if (/\$?\{[^}]*\}/.test(s)) return true // {slug} / ${slug} left unresolved
  if (s.includes('`')) return true // markdown code-span delimiter came along
  return false
}
