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

const CODE_FILE = /\.(t|j)sx?$/

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
    .filter(([path, content]) => CODE_FILE.test(path) && !path.endsWith('.d.ts') && typeof content === 'string')
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
  /** True only when hasFilesMap and every check below passed. */
  clean: boolean
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
    return { hasFilesMap: false, missingImports: [], truncatedFiles: [], validationError: null, clean: false }
  }

  const appEntry = Object.entries(files).find(([path]) => /App\.(t|j)sx?$/.test(path))
  const primaryCode = appEntry ? appEntry[1] : Object.values(files)[0] || ''

  const missingImports = findMissingLocalImports(primaryCode, files)
  const truncatedFiles = findTruncatedFiles(files)

  const blob = buildFileMarkerBlob(files)
  const validation = validateJavaScriptCode(blob, { importsStripped: false, lenient: true })
  const validationError = validation.valid ? null : validation.error || 'invalid'

  const clean = missingImports.length === 0 && truncatedFiles.length === 0 && validation.valid

  return { hasFilesMap: true, missingImports, truncatedFiles, validationError, clean }
}
