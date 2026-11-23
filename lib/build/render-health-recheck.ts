/**
 * Pure, read-only re-verification of a company's CURRENT persisted generation
 * against this repo's own real completeness/validity detectors.
 *
 * Why this exists (#2164): this repo's overnight render-integrity loop keeps
 * finding real companies whose generated app is broken (missing local
 * import, truncated file, undefined-variable reference, …), filing an issue,
 * and — once a fix for the DETECTOR lands — closing it. But nothing ever
 * goes back and checks whether that SPECIFIC company's own persisted
 * generation actually got repaired. #1990 ("Agentive") was closed as
 * completed while its own chatId was, confirmed, still broken 5+ days later.
 * This module (and scripts/recheck-known-render-issues.ts, which uses it) is
 * a one-command way to re-check a tracked list of chatIds instead of
 * resampling the whole public showcase blindly every run.
 *
 * Read-only: only ever inspects an already-fetched `files` map with pure
 * detector functions. Never mutates ZeroDB, the backlog, or Gitea, and needs
 * no credentials — the caller is responsible for fetching
 * `GET /api/generation/{chatId}/files` (a public endpoint).
 */

import { findMissingLocalImports, findTruncatedFiles } from './completeness-gate'
import { validateJavaScriptCode } from '../code-validator'
import { buildSandpackFiles } from '../sandpack/build-files'
import { getBuiltinFiles } from '../sandpack/setup'

const CODE_FILE = /\.(t|j)sx?$/

/**
 * Next.js App Router special files (`app/robots.ts`, `app/sitemap.ts`,
 * `app/layout.tsx`, `app/**\/route.ts`, …) live alongside a company's
 * Sandpack-bound `src/` component tree in the persisted `files` map (the
 * AEO/SEO primitives added since #2170-#2180), but they are ONLY consumed by
 * the separate Railway/Gitea deploy path (`lib/build/company-scaffold.ts`) —
 * never by `buildSandpackFiles()` (confirmed: no `app/` reference anywhere in
 * `lib/sandpack/build-files.ts`) and never by `flattenMultiFile()`'s
 * App.tsx-reachability walk (`app/api/preview/[id]/route.ts`'s single-file
 * preview only inlines what App.tsx actually imports — `app/robots.ts` isn't
 * one of its local imports). So they are excluded here too: this blob exists
 * to mirror what that real preview-time `validateJavaScriptCode()` call
 * actually validates.
 *
 * Real false-positive found live this run (overnight render-integrity loop):
 * without this exclusion, `ridgeline`/`shingle`'s real `app/robots.ts`
 * (`export default function robots(): MetadataRoute.Robots`) and
 * `app/sitemap.ts` (`changeFrequency: 'weekly' as const`) — ordinary,
 * correct Next.js TypeScript, never fed through this plain-JS-oriented
 * validator in production — got concatenated into the blob and threw a
 * catastrophic "Unexpected token" parse error, which this module's
 * `validationError` field then reported as if it were a real live-crash
 * finding for two genuinely healthy companies.
 */
const APP_ROUTER_FILE = /^\/?app\//

/**
 * Reassemble a parsed `files` map into the `// --- FILE: path ---`-marked
 * blob `findUndefinedReferences()`/`validateJavaScriptCode()` (via
 * lib/code-validator.ts's FILE_MARKER) and `completeness-gate.ts`'s own
 * `splitMarkerBlob()` both expect — the same convention
 * `task-implementer.ts`'s `buildImplementationUserPrompt()` uses to produce
 * this shape at generation time in the first place.
 */
export function buildFileMarkerBlob(files: Record<string, string>): string {
  return Object.entries(files)
    .filter(
      ([path, content]) =>
        CODE_FILE.test(path) && !path.endsWith('.d.ts') && !APP_ROUTER_FILE.test(path) && typeof content === 'string',
    )
    .map(([path, content]) => `// --- FILE: ${path.replace(/^\//, '')} ---\n${content}`)
    .join('\n\n')
}

export interface RenderHealthResult {
  /** False when there's no usable files map at all — nothing could be checked. */
  hasFilesMap: boolean
  missingImports: string[]
  truncatedFiles: string[]
  /** validateJavaScriptCode()'s error (duplicate decl / unresolved component / object-as-child / undefined reference / fatal parse), or null when clean. */
  validationError: string | null
  /**
   * #2220 — same validateJavaScriptCode() error, but re-run against
   * buildSandpackFiles()'s self-healed output instead of the raw persisted
   * blob. missingImports/truncatedFiles already got this treatment from
   * #2198 (builtMissingImports/builtTruncatedFiles below); validationError
   * did not, which let a bare-undeclared-JSX-identifier case the sibling-
   * import injector already resolves (e.g. #2026/#2029's revela/younova,
   * both genuinely fixed on main) still read as "confirmed render-breaking"
   * here. Null whenever the self-healed pipeline itself throws (left at the
   * raw value in that case — see the try/catch below) or when it's clean.
   */
  builtValidationError: string | null
  /** True only when hasFilesMap and every check below passed. */
  clean: boolean
  /**
   * #2198 — missingImports/truncatedFiles above describe the RAW persisted
   * generation; they say nothing about what a real visitor's browser
   * actually receives, because `main` runs every raw file through
   * lib/sandpack/build-files.ts's `buildSandpackFiles()` before Sandpack
   * ever sees it, and that pipeline self-heals exactly these two defect
   * classes (stubTruncatedFiles(), stubMissingLocalComponents()) by
   * replacing a truncated file / synthesizing a missing one with an inert
   * `return null` stub. A raw hit that disappears after that pipeline runs
   * is a real generation-quality defect worth feeding the completeness-
   * backfill sweep, but it is NOT a live render-breaking crash — conflating
   * the two produced false "confirmed render-breaking" claims for #2169's
   * `silo`/`f4k20l` companies and #2159's `dispatch`/footer repro (corrected
   * via comment in #2198, not re-filed).
   *
   * builtMissingImports/builtTruncatedFiles are the same two raw detectors
   * re-run against `buildSandpackFiles(files)`'s output instead of the raw
   * `files` map. `confirmedRenderBreaking` is true only when a raw defect
   * exists AND survives self-heal — i.e. a REAL gap in the self-heal nets,
   * worth its own issue per #2198's own suggested framing. `selfHealed` is
   * true when a raw defect existed but every one of it was repaired by the
   * time it reaches the real pipeline.
   */
  builtMissingImports: string[]
  builtTruncatedFiles: string[]
  confirmedRenderBreaking: boolean
  selfHealed: boolean
}

/**
 * Re-run this repo's real structural detectors (`findMissingLocalImports`,
 * `findTruncatedFiles`) plus the real end-to-end validity check
 * (`validateJavaScriptCode`, the same one `app/api/preview/[id]/route.ts`
 * runs at read time) against an already-fetched generation `files` map.
 *
 * `importsStripped: false` because this checks the real persisted source
 * (not the import-stripped preview-renderer path); `lenient: true` because
 * a strict-parse-only failure that only Sandpack's bundler (not the preview
 * renderer) would reject is a narrower, separate concern from this check's
 * purpose (confirming whether a PREVIOUSLY-reported defect is still live).
 */
export function checkRenderHealth(files: Record<string, string> | undefined): RenderHealthResult {
  if (!files || Object.keys(files).length === 0) {
    return {
      hasFilesMap: false,
      missingImports: [],
      truncatedFiles: [],
      validationError: null,
      builtValidationError: null,
      clean: false,
      builtMissingImports: [],
      builtTruncatedFiles: [],
      confirmedRenderBreaking: false,
      selfHealed: false,
    }
  }

  const appEntry = Object.entries(files).find(([path]) => /App\.(t|j)sx?$/.test(path))
  const primaryCode = appEntry ? appEntry[1] : Object.values(files)[0] || ''

  const missingImports = findMissingLocalImports(primaryCode, files)
  const truncatedFiles = findTruncatedFiles(files)

  const blob = buildFileMarkerBlob(files)
  const validation = validateJavaScriptCode(blob, { importsStripped: false, lenient: true })
  const validationError = validation.valid ? null : validation.error || 'invalid'

  const clean = missingImports.length === 0 && truncatedFiles.length === 0 && validation.valid

  // #2198: re-run the same two raw detectors against what actually reaches
  // a visitor's browser (self-healed), not the raw persisted files, so a
  // defect this pipeline already repairs is never reported as a confirmed
  // live crash. Fail-open to the raw result (same "pure detector never
  // blocks on its own failure" philosophy as completeness-gate.ts) if the
  // real pipeline itself throws on this payload — that's its own, separate
  // finding, not something this re-check should hide a crash behind.
  let builtMissingImports = missingImports
  let builtTruncatedFiles = truncatedFiles
  // #2220: starts as the raw validationError (same fail-open fallback as
  // builtMissingImports/builtTruncatedFiles above) — if the self-heal
  // pipeline throws before this gets overwritten below, a raw validation
  // failure is never silently treated as resolved.
  let builtValidationError: string | null = validationError
  try {
    const built = buildSandpackFiles(files)
    const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
    const builtAppCode = built['/App.tsx'] ?? primaryCode
    builtMissingImports = findMissingLocalImports(builtAppCode, built)
    builtTruncatedFiles = findTruncatedFiles(built).filter((p) => !builtinPaths.has(p))

    const builtCompanyFiles = Object.fromEntries(
      Object.entries(built).filter(([path]) => !builtinPaths.has(path)),
    )
    const builtBlob = buildFileMarkerBlob(builtCompanyFiles)
    const builtValidation = validateJavaScriptCode(builtBlob, { importsStripped: false, lenient: true })
    builtValidationError = builtValidation.valid ? null : builtValidation.error || 'invalid'
  } catch {
    // leave builtMissingImports/builtTruncatedFiles/builtValidationError at
    // their raw fallbacks set above the try block
  }

  const hadRawDefect = missingImports.length > 0 || truncatedFiles.length > 0 || validationError !== null
  const survivesSelfHeal =
    builtMissingImports.length > 0 || builtTruncatedFiles.length > 0 || builtValidationError !== null
  const confirmedRenderBreaking = hadRawDefect && survivesSelfHeal
  const selfHealed = hadRawDefect && !survivesSelfHeal

  return {
    hasFilesMap: true,
    missingImports,
    truncatedFiles,
    validationError,
    builtValidationError,
    clean,
    builtMissingImports,
    builtTruncatedFiles,
    confirmedRenderBreaking,
    selfHealed,
  }
}
