/**
 * Completeness gate (builder#333) — detects TRUNCATED multi-file generations.
 *
 * Repro (chatId x-eTnc7qjv_AYvQFucUvH, app 'beacon'): a multi-file app was
 * persisted as one concatenated blob whose App imports six local components but
 * the stream was cut mid-component — `Analytics` is imported and used yet never
 * defined anywhere in the payload. The parse gate can miss this class (each
 * surviving file parses fine); the app then ships and dies at bundle/flatten
 * time with "Unexpected token" or "X is not defined".
 *
 * findMissingLocalImports() is the PURE detector: given the generated code
 * (single-file, concatenated multi-file blob with `// --- FILE:` markers, or a
 * markdown-wrapped variant) and optionally the parsed files map, it returns the
 * local import specifiers (./components/X, ./X, ../X, @/X) that have NO
 * matching definition in the payload — neither a file that satisfies the import
 * nor an inline definition of the imported identifiers.
 *
 * npm imports, style/asset imports, type-only imports, side-effect imports and
 * runtime-provided modules (the AIKit/shadcn bundles Sandpack injects) are all
 * ignored — the detector only flags imports the preview runtime genuinely
 * cannot satisfy, so a false "truncated" verdict never blocks a working app.
 *
 * Wired into checkAppReady (lib/build/ready-gate.ts): a flagged generation is
 * NOT marked ready — register-app returns its 422 retry path and the client
 * regenerates instead of persisting a broken app.
 */

/** One parsed import statement with its local specifier and local bindings. */
interface LocalImport {
  /** The module specifier as written (e.g. './components/Analytics'). */
  spec: string
  /** Local binding names introduced (default/named/namespace). Empty for side-effect imports. */
  bindings: string[]
}

/** File extensions that count as source code. */
const CODE_FILE = /\.(t|j)sx?$/

/** Style/asset/data specifiers — never resolve to a component definition; ignore. */
const ASSET_EXT = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|json|md|txt|ico|woff2?)$/i

/** Resolution suffixes tried against the files map (Node/bundler style). */
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']

/**
 * Modules the PREVIEW RUNTIME provides even when absent from the generated
 * payload: the AIKit bundle and shadcn/ui components sandpack-preview injects,
 * and the shadcn `lib/utils` helper. Importing these is always satisfiable.
 */
const RUNTIME_PROVIDED: RegExp[] = [
  /(^|\/)components\/aikit(\/|$)?/,
  /(^|\/)components\/ui\//,
  /(^|\/)lib\/utils$/,
]

const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/** Is this specifier a LOCAL module reference (relative or @/ alias)? */
function isLocalSpecifier(spec: string): boolean {
  return /^(\.\.?\/|@\/)/.test(spec)
}

/** Strip relative/alias prefixes for whitelist matching ('./components/aikit' → 'components/aikit'). */
function stripLocalPrefix(spec: string): string {
  return spec.replace(/^@\//, '').replace(/^(\.\.?\/)+/, '')
}

function isRuntimeProvided(spec: string): boolean {
  const bare = stripLocalPrefix(spec).replace(/\.(t|j)sx?$/, '')
  return RUNTIME_PROVIDED.some((re) => re.test(bare))
}

/**
 * Parse every local import statement in a chunk of source. Handles:
 *   import X from './x'            → bindings [X]
 *   import { A, B as C } from '…'  → bindings [A, C]
 *   import X, { A } from '…'       → bindings [X, A]
 *   import * as NS from '…'        → bindings [NS]
 *   import './x'                   → bindings [] (side-effect)
 *   import type { T } from '…'     → skipped (erased at runtime)
 */
export function parseLocalImports(code: string): LocalImport[] {
  const out: LocalImport[] = []
  // Statement-level regex: clause is everything between `import` and `from`.
  const withClause = /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g
  const sideEffect = /import\s*['"]([^'"]+)['"]/g

  let m: RegExpExecArray | null
  while ((m = withClause.exec(code)) !== null) {
    const clause = m[1].trim()
    const spec = m[2]
    if (!isLocalSpecifier(spec)) continue
    if (/^type\s/.test(clause)) continue // import type — type-only, erased
    out.push({ spec, bindings: parseClauseBindings(clause) })
  }
  while ((m = sideEffect.exec(code)) !== null) {
    const spec = m[1]
    if (!isLocalSpecifier(spec)) continue
    // Avoid double-counting `from '…'` matches: side-effect imports have no clause.
    const before = code.slice(Math.max(0, m.index - 6), m.index)
    if (/from\s*$/.test(before)) continue
    out.push({ spec, bindings: [] })
  }
  return out
}

/** Extract the local binding names from an import clause. */
function parseClauseBindings(clause: string): string[] {
  const bindings: string[] = []
  // Namespace: * as NS
  const ns = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/)
  if (ns) bindings.push(ns[1])
  // Named: { A, B as C, type D }
  const named = clause.match(/\{([^}]*)\}/)
  if (named) {
    for (const raw of named[1].split(',')) {
      const s = raw.trim()
      if (!s || /^type\s/.test(s)) continue // inline type specifier — erased
      bindings.push(s.split(/\s+as\s+/).pop()!.trim())
    }
  }
  // Default: leading identifier before any `{` or `*`
  const head = clause.split(/[{*]/)[0].replace(/,\s*$/, '').trim()
  if (head && /^[A-Za-z_$][\w$]*$/.test(head)) bindings.push(head)
  return bindings.filter((b) => /^[A-Za-z_$][\w$]*$/.test(b))
}

/** Does the payload define this identifier (function/class/const/let/var)? */
function definesIdentifier(content: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(?:^|[\\n;{(\\s])(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function|class)\\s+${esc}\\b` +
      `|(?:^|[\\n;{(\\s])(?:export\\s+)?(?:const|let|var)\\s+${esc}\\b`,
  )
  return re.test(content)
}

/** Directory part of a file path ('/src/App.tsx' → '/src'). */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '' : path.slice(0, i)
}

/** Resolve './a/../b' style segments; returns a slash-joined path with no leading '/'. */
function normalizeSegments(path: string): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/**
 * Build the lookup index of a files map: each key normalized (no leading '/')
 * plus tolerant variants without the 'src/'‌ / 'app/' prefix — Sandpack
 * duplicates /src/* at root so both import styles must resolve.
 */
function buildKeyIndex(files: Record<string, string>): Set<string> {
  const idx = new Set<string>()
  for (const key of Object.keys(files)) {
    const norm = normalizeSegments(key)
    idx.add(norm)
    idx.add(norm.replace(/^src\//, ''))
    idx.add(norm.replace(/^app\//, ''))
  }
  return idx
}

/** Can `spec` (imported from a file in `fromDir`) be resolved against the index? */
function resolvesInIndex(idx: Set<string>, fromDir: string, spec: string): boolean {
  const base = spec.startsWith('@/')
    ? spec.slice(2)
    : `${fromDir}/${spec}`
  const norm = normalizeSegments(base)
  const variants = [norm, norm.replace(/^src\//, ''), `src/${norm}`]
  for (const v of variants) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (idx.has(v + suffix)) return true
    }
  }
  return false
}

/** Split a concatenated `// --- FILE:` blob into a files map (lightweight, no sanitizing). */
function splitMarkerBlob(code: string): Record<string, string> {
  const files: Record<string, string> = {}
  let current: string | null = null
  let buf: string[] = []
  for (const line of code.split('\n')) {
    const m = line.match(FILE_MARKER)
    if (m) {
      if (current) files[current.startsWith('/') ? current : `/${current}`] = buf.join('\n')
      current = m[1].trim()
      buf = []
    } else {
      buf.push(line)
    }
  }
  if (current) files[current.startsWith('/') ? current : `/${current}`] = buf.join('\n')
  return files
}

/**
 * THE DETECTOR. Returns the local import specifiers with no matching definition
 * in the payload — empty array means the generation is complete (w.r.t. local
 * imports). Never throws.
 *
 * @param code  Raw generated payload: single file, concatenated multi-file blob
 *              (with `// --- FILE:` markers), or markdown-wrapped code.
 * @param files Optional parsed files map (the SSE `files` payload / durable
 *              files_json). When present it is the authority for resolution.
 */
export function findMissingLocalImports(
  code: string,
  files?: Record<string, string>,
): string[] {
  try {
    const raw = code || ''
    let map = files && Object.keys(files).length > 0 ? files : null

    // A concatenated multi-file blob IS a files map — split it so per-file
    // resolution works (the beacon repro: blob missing the Analytics section).
    if (!map && /\/\/\s*---\s*FILE:/.test(raw)) {
      map = splitMarkerBlob(raw)
    }

    const missing = new Set<string>()

    if (map) {
      const idx = buildKeyIndex(map)
      // Concatenated payload text — fallback check for inline definitions.
      const allContent = Object.entries(map)
        .filter(([p]) => CODE_FILE.test(p))
        .map(([, c]) => c)
        .join('\n')
      for (const [path, content] of Object.entries(map)) {
        if (!CODE_FILE.test(path) || path.endsWith('.d.ts') || typeof content !== 'string') continue
        for (const imp of parseLocalImports(content)) {
          if (ASSET_EXT.test(imp.spec) || isRuntimeProvided(imp.spec)) continue
          if (resolvesInIndex(idx, dirOf(`/${normalizeSegments(path)}`), imp.spec)) continue
          // File missing — the component may still be defined inline somewhere
          // in the payload (flatten handles that); only flag when the imported
          // identifiers have NO definition anywhere.
          if (imp.bindings.length > 0 && imp.bindings.every((b) => definesIdentifier(allContent, b))) continue
          if (imp.bindings.length === 0) continue // side-effect import of a non-asset — unverifiable, don't block
          missing.add(imp.spec)
        }
      }
    } else {
      // Single concatenated payload with no file structure: a local import is
      // only satisfied if its identifiers are defined inline in the blob.
      for (const imp of parseLocalImports(raw)) {
        if (ASSET_EXT.test(imp.spec) || isRuntimeProvided(imp.spec)) continue
        if (imp.bindings.length === 0) continue
        if (imp.bindings.every((b) => definesIdentifier(raw, b))) continue
        missing.add(imp.spec)
      }
    }

    return [...missing]
  } catch {
    // Pure detector must never block on its own failure — fail-open.
    return []
  }
}
