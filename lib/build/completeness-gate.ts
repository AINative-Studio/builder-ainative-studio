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
 *
 * findUndeclaredJsxComponents() covers the INVERSE gap (repro: chatId
 * Cnpaj8K87WqxsAj3G-WBc, app 'beacon' — 2026-09-02). `ScheduleView.tsx` used
 * `<Card>`/`<CardContent>` throughout but never imported them, even though
 * `ui/card.tsx` defining both WAS fully emitted elsewhere in the same payload.
 * findMissingLocalImports can't see this: it only walks DECLARED imports
 * looking for a missing definition — a component that never declared the
 * import at all has nothing to walk. The share-page flattener (flatten-
 * multifile.ts) only inlines a file when something actually imports it, so
 * `Card`/`CardContent` are silently dropped and the browser dies on the
 * flattened output with an undefined-reference/parse failure the user sees as
 * a raw "Unexpected token" panel.
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
 *
 * Real bug found live (Meridian, 2026-09-10): a file the model placed INSIDE
 * components/ itself (e.g. components/Header.tsx) correctly writes a
 * SIBLING-relative import to the bundle — './ui/button', not
 * './components/ui/button' — since stripLocalPrefix() only strips the
 * leading './'/'../' segments, this became the bare spec 'ui/button', which
 * the two `components/...` patterns below never matched (they require the
 * literal substring 'components/ui/' or 'components/aikit' to be PRESENT).
 * Confirmed live: register-app's completeness gate rejected 4 consecutive
 * real generations with "imported local module(s) never defined:
 * ./ui/button, ./ui/input, ./ui/badge...", even though those files
 * genuinely exist in the injected bundle (lib/sandpack/shadcn-bundle.ts,
 * lib/sandpack/aikit-bundle.ts) — this is the exact same import-path-depth
 * blindness already fixed once for codegen-time injection in
 * lib/multi-file-parser.ts's relativeComponentsPrefix(), but unfixed here in
 * the SEPARATE gate that checks the model's own directly-written imports.
 * Added a second alternation per bundle (bare 'ui/...' / bare 'aikit') so
 * both the root-relative and sibling-relative forms resolve.
 */
const RUNTIME_PROVIDED: RegExp[] = [
  /(^|\/)components\/aikit(\/|$)?/,
  /(^|\/)components\/ui\//,
  // Sibling-relative forms only (anchored to the START of the stripped
  // path) — a file already living inside components/ writes './aikit' or
  // './ui/button' rather than './components/aikit'/'./components/ui/button'.
  // Anchoring to ^ (not matching 'ui/' anywhere, e.g. a hypothetical
  // model-authored components/dashboard/ui/Custom.tsx) keeps this narrow to
  // the exact sibling-relative shape the bundles are actually placed at.
  /^aikit(\/|$)/,
  /^ui\//,
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

/** Capitalized JSX opening tags: `<Card`, `<Card.Item`, `<Card />` — not `<div>`. */
const JSX_TAG = /<([A-Z][\w$]*)(?:\.[A-Za-z_$][\w$]*)?[\s/>]/g

/** Global/ambient identifiers a generated component may reference without a local import. */
const KNOWN_GLOBAL_JSX = new Set([
  'React',
  'Fragment',
  'Suspense',
  'ErrorBoundary',
])

/** Every capitalized identifier the payload defines OR imports from a non-local (npm) specifier. */
function collectKnownIdentifiers(content: string): Set<string> {
  const known = new Set<string>(KNOWN_GLOBAL_JSX)
  const withClause = /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = withClause.exec(content)) !== null) {
    for (const b of parseClauseBindings(m[1].trim())) known.add(b)
  }
  for (const m2 of content.matchAll(/(?:^|[\n;{(\s])(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    known.add(m2[1])
  }
  for (const m3 of content.matchAll(/(?:^|[\n;{(\s])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    known.add(m3[1])
  }
  return known
}

/**
 * THE INVERSE DETECTOR. Returns capitalized JSX component names that a file
 * renders but never imports or defines — even though the payload defines them
 * SOMEWHERE ELSE (the beacon 'Card'/'CardContent' repro). Empty array means
 * every JSX tag used resolves to an import or a local definition.
 *
 * Only meaningful with a files map: without per-file boundaries there is no
 * "this file never imported it" to detect (a single-blob payload already gets
 * inline-definition coverage from findMissingLocalImports).
 */
export function findUndeclaredJsxComponents(
  code: string,
  files?: Record<string, string>,
): string[] {
  try {
    let map = files && Object.keys(files).length > 0 ? files : null
    if (!map && /\/\/\s*---\s*FILE:/.test(code || '')) {
      map = splitMarkerBlob(code || '')
    }
    if (!map) return []

    const problems = new Set<string>()
    for (const [path, content] of Object.entries(map)) {
      if (!CODE_FILE.test(path) || path.endsWith('.d.ts') || typeof content !== 'string') continue
      const known = collectKnownIdentifiers(content)
      for (const m of content.matchAll(JSX_TAG)) {
        const name = m[1]
        if (!known.has(name)) problems.add(name)
      }
    }
    return [...problems]
  } catch {
    // Pure detector must never block on its own failure — fail-open.
    return []
  }
}

/**
 * DUPLICATE-LANDMARK DETECTOR (builder#816, repro: `agentive-product`,
 * issue #815) — a narrow, deterministic DOM-SHAPE check for a bug class the
 * parse/completeness gates above structurally cannot see: two elements that
 * are each individually syntactically valid, both fully resolve their
 * imports, and both parse fine, yet BOTH render simultaneously-visible
 * duplicate UI for the same structural role (confirmed live via
 * `document.querySelectorAll('aside').length === 2`: a real desktop sidebar
 * `data-agent-context="sidebar"` plus a "mobile" drawer
 * `data-agent-context="sidebar-mobile"` that had no `fixed`/`absolute`
 * positioning and no hide/off-canvas class at all — so it sat inline and
 * visible on every viewport, not just mobile).
 *
 * The codegen pipeline's own agent-manifest pattern (lib/professional-
 * prompt.ts) already tags structural elements with `data-agent-context`, and
 * that same attribute is the cheapest deterministic signal available: a
 * landmark ROLE (sidebar/header/main-content/nav) should have exactly ONE
 * simultaneously-visible instance. A second instance of the SAME role is only
 * legitimate when it is genuinely, verifiably hidden by a real Tailwind
 * hide/off-canvas class — two elements sharing a role is not inherently wrong
 * (a correctly-built responsive drawer looks exactly like this), so this only
 * flags a duplicate that has NO such class on it at all.
 *
 * Deliberately STATIC (string/regex scan over the already-flattened source,
 * the exact artifact the preview renders — mirrors the FLATTENED-PARSE gate
 * in ready-gate.ts) rather than a headless render: resolving whether a
 * Tailwind class ACTUALLY hides the element at a given breakpoint would
 * require real CSS resolution (a genuinely flaky, render-dependent check this
 * repo has deliberately moved away from — see the committee/aerosol gate
 * history). Instead this approximates conservatively: does the extra
 * instance carry ANY class/attribute from the known hide/off-canvas
 * vocabulary at all? A real off-canvas drawer always uses at least one of
 * these (that's the only way Tailwind expresses "hidden until toggled"), so
 * this never false-flags a correctly-built drawer, and it exactly catches the
 * #815 shape (zero such indicators present).
 *
 * Only meaningful with a files map / FILE-marker blob — same as
 * findUndeclaredJsxComponents, this needs a single flattened view of "what
 * will actually render together," which the caller is expected to pass
 * pre-flattened (ready-gate.ts uses flattenMultiFile before calling this).
 */

/** data-agent-context landmark roles that must have exactly one VISIBLE instance. */
const SINGULAR_LANDMARK_ROLES = ['sidebar', 'header', 'main-content', 'nav', 'footer']

/**
 * Reduce a data-agent-context value to its base landmark role, so
 * "sidebar-mobile" / "sidebar_mobile" / "mobile-sidebar" / "sidebar" all
 * group under "sidebar". Only matches a KNOWN role — an app-specific value
 * like "revenue-chart" or "agent-42" never collides with anything.
 */
function baseLandmarkRole(contextValue: string): string | null {
  const v = contextValue.toLowerCase()
  const segments = v.split(/[-_]/)
  for (const role of SINGULAR_LANDMARK_ROLES) {
    if (v === role) return role
    // "main-content" is itself two segments — match it as a whole two-segment
    // pair before falling through to single-segment matching, so a value like
    // "main-content-mobile" groups under "main-content" and a lone "content"
    // segment elsewhere never falsely matches it.
    if (role === 'main-content' && /(?:^|[-_])main[-_]content(?:[-_]|$)/.test(v)) return role
    if (role === 'main-content') continue
    // role as a whole hyphen/underscore-delimited segment, anywhere in the
    // value (sidebar-mobile, mobile-sidebar, sidebar_desktop) — not a
    // substring match (e.g. a value like "podcastheader" must not match
    // "header", and "aside" must not match "sidebar").
    if (segments.includes(role)) return role
  }
  return null
}

/**
 * Real Tailwind hide / off-canvas indicators. Deliberately broad (breakpoint-
 * prefixed `hidden`, `sr-only`, transform-based off-canvas, inert/aria-hidden,
 * conditional-render markers) — this is a conservative allow-list: ANY of
 * these present is enough to treat the element as a legitimate second
 * instance, since a false "this is fine" (missing a real bug) is much
 * cheaper here than a false "this is broken" (blocking a correctly-built
 * responsive drawer from shipping at all).
 */
const HIDE_OR_OFFCANVAS_INDICATORS = [
  /(?:^|[\s"'`])hidden(?:[\s"'`]|$)/, // bare `hidden` utility/attribute
  /(?:^|[\s"'`])(?:sm|md|lg|xl|2xl):hidden(?:[\s"'`]|$)/, // breakpoint-hidden
  /(?:^|[\s"'`])sr-only(?:[\s"'`]|$)/,
  /-translate-x-(?:full|\[[^\]]+\])/, // slid off-canvas horizontally
  /-translate-y-(?:full|\[[^\]]+\])/, // slid off-canvas vertically
  /\btranslate-x-0\b[\s\S]{0,80}(?:md|lg|xl):-translate-x-full/, // toggled-open drawer whose CLOSED state is off-canvas at a breakpoint
  /\baria-hidden\s*=\s*["']true["']/,
  /\binert\b/,
  /\bopacity-0\b/,
  /\bpointer-events-none\b/,
  /\bfixed\b[\s\S]{0,120}\bz-(?:40|50|\[)/, // overlay drawer pattern: fixed + high z-index
]

/** Does this opening tag's attributes carry ANY real hide/off-canvas signal? */
function hasHideOrOffCanvasIndicator(openingTag: string): boolean {
  return HIDE_OR_OFFCANVAS_INDICATORS.some((re) => re.test(openingTag))
}

/** One `data-agent-context="value"` match with its full opening tag for class inspection. */
interface LandmarkMatch {
  value: string
  openingTag: string
}

/** Find every element carrying a data-agent-context attribute, with its full opening tag. */
function findLandmarkElements(content: string): LandmarkMatch[] {
  const out: LandmarkMatch[] = []
  // Match a full opening tag `<Tag ...>` (non-greedy, no nested `<`/`>` inside
  // attribute values we care about — generated JSX attributes don't nest raw
  // angle brackets), then confirm it carries data-agent-context.
  const tagRe = /<[A-Za-z][\w.]*(?:\s[^<>]*)?>/g
  for (const m of content.matchAll(tagRe)) {
    const tag = m[0]
    const ctx = tag.match(/data-agent-context\s*=\s*(?:["']([^"']*)["']|\{['"`]([^'"`]*)['"`]\})/)
    if (!ctx) continue
    const value = ctx[1] ?? ctx[2] ?? ''
    if (!value) continue
    out.push({ value, openingTag: tag })
  }
  return out
}

/** One flagged duplicate-landmark problem. */
export interface DuplicateLandmark {
  /** The landmark role that appears more than once (e.g. 'sidebar'). */
  role: string
  /** The data-agent-context values found for this role, in source order. */
  contextValues: string[]
}

/**
 * THE DUPLICATE-LANDMARK DETECTOR. Given the flattened/concatenated source
 * (the SAME artifact the preview renders, so duplicates across files are only
 * evaluated once genuinely simultaneously renderable), returns the singular
 * landmark roles that have more than one instance where at least one extra
 * instance has NO hide/off-canvas indicator — i.e. would render permanently
 * visible alongside the first. Empty array means either no duplicates, or
 * every duplicate is a verifiably-hidden legitimate responsive variant.
 *
 * Never throws — pure detector, fail-open on its own failure like its
 * siblings in this file.
 */
export function findDuplicateLandmarkElements(code: string): DuplicateLandmark[] {
  try {
    const src = code || ''
    if (!src.trim()) return []

    const landmarks = findLandmarkElements(src)
    if (landmarks.length < 2) return []

    // Group by base role, tracking whether EVERY instance beyond the first
    // real (non-hidden) one lacks a hide/off-canvas indicator.
    const byRole = new Map<string, LandmarkMatch[]>()
    for (const lm of landmarks) {
      const role = baseLandmarkRole(lm.value)
      if (!role) continue
      const list = byRole.get(role) ?? []
      list.push(lm)
      byRole.set(role, list)
    }

    const problems: DuplicateLandmark[] = []
    for (const [role, instances] of byRole) {
      if (instances.length < 2) continue
      // How many instances render with no verifiable hide/off-canvas signal?
      const visibleCount = instances.filter((i) => !hasHideOrOffCanvasIndicator(i.openingTag)).length
      // Legitimate: exactly one instance is ever simultaneously visible (the
      // rest are provably hidden — a correctly-built responsive drawer).
      if (visibleCount > 1) {
        problems.push({ role, contextValues: instances.map((i) => i.value) })
      }
    }
    return problems
  } catch {
    // Pure detector must never block on its own failure — fail-open.
    return []
  }
}
