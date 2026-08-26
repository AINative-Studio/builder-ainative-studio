/**
 * Preview engine routing (#291) — decides whether a generated app renders via
 * Sandpack (real bundler, multi-file) or the hardened Babel-in-iframe path
 * (fast, single-file).
 *
 * Decision (per the #291 "adopt for multi-file, keep Babel for single-file"
 * outcome): an app is a Sandpack candidate when it is genuinely MULTI-FILE — more
 * than one real source file, or it uses cross-file relative imports that the
 * flatten-to-one-script Babel path handles poorly. Everything else stays on the
 * proven Babel path (the common single-file case), so we never regress it.
 *
 * The files payload comes straight from the /api/chat-ws SSE `files` event
 * (same generating instance → no cross-instance store fetch), so this runs
 * client-side on the exact map Sandpack would receive.
 */

/**
 * Files that are not real APP-COMPONENT source and must not count toward
 * "multi-file". Excludes:
 *  - non-code files (.txt/.json/.xml).
 *  - SEO/scaffold the generator always emits (robots.ts, sitemap.ts, manifest,
 *    llms.txt) — present even for a single-file app, so counting them would
 *    falsely flag every app as multi-file.
 *  - Next.js framework files (layout.tsx, not a rendered component in the preview).
 * Only genuine app components/pages/lib count, which is what decides Sandpack.
 */
function isSourceFile(path: string): boolean {
  if (!/\.(t|j)sx?$/.test(path)) return false
  if (path.endsWith('.d.ts')) return false
  if (path.includes('/node_modules/')) return false
  const base = path.split('/').pop() || ''
  // SEO / framework scaffold — emitted regardless of app complexity.
  const SCAFFOLD = new Set(['robots.ts', 'robots.tsx', 'sitemap.ts', 'sitemap.tsx', 'layout.tsx', 'layout.ts', 'manifest.ts', 'manifest.tsx', 'not-found.tsx', 'loading.tsx', 'error.tsx'])
  if (SCAFFOLD.has(base)) return false
  return true
}

/** How many real source files does this payload contain? */
export function countSourceFiles(files: Record<string, string> | null | undefined): number {
  if (!files) return 0
  return Object.entries(files).filter(
    ([path, content]) => isSourceFile(path) && typeof content === 'string' && content.trim().length > 0,
  ).length
}

/**
 * Does any source file import from another LOCAL file (relative or @/ alias)?
 * A single-file app has no cross-file imports; a real multi-file app does. This
 * catches apps the model splits into components/pages that Babel-in-iframe would
 * flatten and break.
 */
export function hasCrossFileImports(files: Record<string, string> | null | undefined): boolean {
  if (!files) return false
  const localImport = /\bimport\b[^'"]*['"](\.\.?\/|@\/)/
  for (const [path, content] of Object.entries(files)) {
    if (!isSourceFile(path) || typeof content !== 'string') continue
    if (localImport.test(content)) return true
  }
  return false
}

/**
 * Should this generated app render via Sandpack rather than the Babel iframe?
 * TRUE when it is genuinely multi-file: >1 real source file OR it uses cross-file
 * local imports. Single-file apps (the common case) stay on the hardened Babel
 * path — Sandpack is additive, never a regression to what already works.
 */
export function shouldUseSandpack(files: Record<string, string> | null | undefined): boolean {
  if (!files) return false
  const n = countSourceFiles(files)
  if (n === 0) return false
  return n > 1 || hasCrossFileImports(files)
}
