/**
 * Shared Sandpack files pipeline, extracted from components/chat/sandpack-preview.tsx
 * (2026-10-15) so the real preview component and scripts/fixtures/sandpack-verify's
 * --chat-id verification harness run the EXACT same logic.
 *
 * WHY THIS EXISTS: the --chat-id harness (scripts/fixtures/sandpack-verify/chat-id.ts)
 * fetched raw generated files and sent them straight to the bundler, skipping this
 * fix pipeline entirely (path-alias rewrite, missing-import safety nets, de-dupe).
 * That produced false FAILs — a real app ("Wallify", chatId
 * z4nabGqvy_UURyaKnCY8J) "failed" in the harness with "Separator is not defined"
 * while the real live /preview/{id} page rendered it with zero console errors,
 * because only the real page's SandpackPreview component ran the shadcn
 * import-injection safety net that adds the missing `import { Separator } from
 * './components/ui/separator'` line. Extracting this logic once means the harness
 * can never drift out of sync with what production actually does again.
 */
import { fixJsxErrors, isAllowlistedPackage } from './jsx-fixer'
import { getBuiltinFiles } from './setup'
import { sanitizeForSandpack } from '../code-validator'
import { sandpackDbTokenShim } from './db-token-shim'
import { detectRootComponent, hasDefaultExport } from '../component-detector'

/**
 * #1561 — when provided, injects the db-token-shim module (see that file's
 * doc comment for the full root-cause writeup) as /db-token-shim.ts and
 * imports it FIRST in /index.tsx, before the real app's own `import App
 * from './App'` — so window.fetch is patched before any of the generated
 * app's own code can call it. `origin` is the real Builder origin
 * (builder.ainative.studio in production) the Sandpack bundler's iframe
 * must call back to; `dbToken` is the same per-company signed token the
 * single-file preview's dbTokenShim attaches, minted via
 * lib/build/preview-tokens.ts.
 */
export interface SandpackDbShimOptions {
  origin: string
  dbToken: string
}

/** Index of the closing `quote` that ends the string starting at `openIdx` (honoring `\`-escapes), or -1 if unterminated. */
function findStringEnd(code: string, openIdx: number, quote: string): number {
  let i = openIdx + 1
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue }
    if (code[i] === quote) return i
    i++
  }
  return -1
}

/**
 * Index of the closing `` ` `` that ends the template literal starting at
 * `openIdx` (honoring `\`-escapes and skipping over `${}` interpolations),
 * or -1 if unterminated.
 *
 * The `${}` skip matters because a `${}` interpolation can itself contain a
 * nested backtick template literal (e.g. a ternary picking between two
 * backtick-quoted strings) — without it, this returns the index of that
 * INNER backtick instead of the real outer closing one, so
 * maskCommentsAndStrings() below stops masking too early and leaves the
 * rest of the outer literal's content (plus whatever real code follows the
 * true closing backtick) unmasked. A generated landing page rendering a
 * "Quickstart" code sample via `` `base ${active ? `import React` : `x`}` ``
 * then has its own literal "import React" text read as if it were real
 * code, which can fool the "is React already imported" / hooks-usage check
 * this function feeds into.
 */
function findBacktickEnd(code: string, openIdx: number): number {
  let i = openIdx + 1
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue }
    if (code[i] === '`') return i
    if (code[i] === '$' && code[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      while (j < code.length && depth > 0) {
        if (code[j] === '{') depth++
        else if (code[j] === '}') depth--
        j++
      }
      i = j
      continue
    }
    i++
  }
  return -1
}

/**
 * `code` with every `//` line comment, `/* ... *\/` block comment, and
 * string/template-literal CONTENT blanked to spaces of the same length
 * (preserving delimiters and every other character's index, including
 * newlines), so a literal mention of real import/hook text inside a
 * comment OR inside a quoted/backtick string (e.g. a landing page
 * rendering a "Quickstart" code sample as a string) can never be mistaken
 * for a real import statement or a real hook call by the plain
 * `.includes()`/regex checks below. Safe to blank string/template-literal
 * content for this purpose specifically: a real `import` statement or a
 * real hook call is never itself written inside a string literal.
 *
 * Introduced for the React/hooks import-injection guard (#1725); reused
 * below by the shadcn/AIKit auto-import guards' own "already imported"
 * checks (#1729) rather than each adding its own copy.
 */
function maskCommentsAndStrings(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    // Real bug found live (this run — company 'younova's StudyStats.tsx
    // "Cards you're struggling with", 'letterpress'-idea Configurator.tsx
    // "We'll be in touch", 'shutter's Footer.tsx "who'd rather shoot"): a
    // `'` can legitimately be an apostrophe inside plain JSX TEXT content
    // (a contraction in marketing copy, which this entire .tsx file is full
    // of), not the start of a JS string literal — this function has no
    // notion of JSX text vs. JS expression context, so it always treated a
    // bare `'` as opening a string and searched forward for the next `'`
    // to close it, desyncing the mask for everything that followed (the
    // next unrelated `'...'` string literal got blanked-then-unblanked
    // INVERTED — visible where it should be masked and vice versa — right
    // through the rest of the file). Every shadcn/AIKit/lucide/sibling-
    // import "already imported"/"is used" check below runs against this
    // masked view, so a real `<Badge>`/`<Separator>`/etc. JSX usage AFTER
    // the contraction silently failed every one of those checks, leaving a
    // real, existing shadcn component with no import injected at all.
    //
    // A `'` that opens a genuine JS string/char literal is never written
    // with no separator directly after an identifier/number character —
    // `foo'bar'` isn't valid JS, so a `'` immediately preceded by a word
    // character (letter/digit/_/$) can only be a contraction inside prose,
    // never a real opening quote. Treating it as ordinary text (not a
    // string delimiter) is therefore safe for real code and fixes the
    // JSX-text case. Only `'` needs this — English contractions never use
    // `"`.
    if (ch === "'" && i > 0 && /[A-Za-z0-9_$]/.test(code[i - 1])) {
      out += ch
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      const realEnd = end === -1 ? code.length - 1 : end
      out += code.slice(i, realEnd + 1).replace(/[^\n]/g, ' ')
      i = realEnd + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      const realEnd = end === -1 ? code.length - 1 : end
      out += code.slice(i, realEnd + 1).replace(/[^\n]/g, ' ')
      i = realEnd + 1
      continue
    }
    if (ch === '/' && next === '/') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    if (ch === '/' && next === '*') {
      let end = code.indexOf('*/', i + 2)
      end = end === -1 ? code.length : end + 2
      out += ' '.repeat(Math.min(end, code.length) - i)
      i = Math.min(end, code.length)
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Does this code import a bare (non-relative, non-aliased) package specifier
 * that isn't actually declared as a Sandpack dependency? Mirrors jsx-fixer's
 * own `isAllowlistedPackage` (the real `customSetup.dependencies` list), but
 * only needs a yes/no answer here rather than a full stub rewrite — this is
 * used to decide whether a generated override at a known builtin path is
 * safe to keep, not to repair the file in place (see its call site below).
 * Matches both `import ... from 'pkg'` and `export ... from 'pkg'` — Sandpack
 * resolves either form identically, so a re-export is just as crash-prone.
 */
function hasUnresolvableBareImport(code: string): boolean {
  // Matches the original #1790 fix's own scan exactly (unmasked, same as
  // `/from\s+['"]shadcn(?:\/[^'"]*)?['"]/.test(content)` it replaces) —
  // deliberately NOT comment-masked here, since `content` at this call site
  // is the generated file's RAW text (only sanitizeForSandpack has run), and
  // unlike obedience-gate.ts's compliance checks this only ever widens which
  // files get the safe known-good builtin kept over a broken override; a
  // false positive from a comment merely mentioning a bad package name costs
  // nothing worse than keeping the builtin it would otherwise have kept
  // anyway if the import were real.
  const re = /\bfrom\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue
    if (!isAllowlistedPackage(spec)) return true
  }
  return false
}

/**
 * #2016: the AIKit/shadcn auto-import safety nets below decide a component
 * is "already imported" (and so skip injecting the correction) by checking
 * only whether the identifier appears somewhere between `import` and `from`
 * — not whether that import's `from` clause actually resolves to the
 * component's real bundle. A generated file that imports e.g. `AIKitBanner`
 * from `./components/ui` (the shadcn barrel, not `./components/aikit`,
 * where it's really exported) satisfies that check and the real, resolvable
 * import is never injected, leaving the wrong-bundle import live and
 * unresolvable in Sandpack.
 *
 * Detaches `name` from any single-line `import { ... } from '...'`
 * statement whose module path isn't one of `acceptableModules`, dropping
 * the whole statement if `name` was its only named specifier. This makes
 * `name` look "not yet imported" again so the ordinary injection logic
 * right below adds a correct, resolvable import instead of leaving a
 * second, conflicting one. A no-op when `name` isn't imported at all, or is
 * already imported from a bundle that really exports it — `Skeleton` is
 * exported by both the aikit and the shadcn bundle, so either path is
 * legitimate and neither should be rewritten to the other.
 */
/**
 * Global/ambient identifiers a generated component may reference as a JSX
 * tag without ever importing or declaring them — same list as
 * completeness-gate.ts's own `KNOWN_GLOBAL_JSX` (kept in sync by hand; this
 * file doesn't import that one to avoid coupling the Sandpack-preview build
 * pipeline to the generation-time completeness gate). Used by the
 * undeclared-JSX catch-all stub (#2026) below so it never "fixes" one of
 * these by injecting a redundant local declaration.
 */
const KNOWN_GLOBAL_JSX_NAMES = new Set(['React', 'Fragment', 'Suspense', 'ErrorBoundary'])

function detachFromWrongPathImport(code: string, name: string, acceptableModules: string[]): string {
  const importLineRe = /^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?\s*$/gm
  return code.replace(importLineRe, (fullLine, specifiers: string, quote: string, modulePath: string) => {
    if (acceptableModules.includes(modulePath)) return fullLine
    const specs = specifiers.split(',').map(s => s.trim()).filter(Boolean)
    const matches = (s: string) => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim() === name
    if (!specs.some(matches)) return fullLine
    const remaining = specs.filter(s => !matches(s))
    return remaining.length > 0
      ? `import { ${remaining.join(', ')} } from ${quote}${modulePath}${quote}`
      : ''
  })
}

/**
 * Build the final Sandpack `files` map from a generated app's raw files map,
 * exactly as components/chat/sandpack-preview.tsx does: overlay onto builtins,
 * normalize /src and /app paths, assemble /App.tsx as the entry point, then run
 * the React/AIKit/shadcn/lucide import-injection safety nets + final de-dupe on
 * every generated .tsx file.
 */
export function buildSandpackFiles(files: Record<string, string>, shim?: SandpackDbShimOptions): Record<string, string> {
  const builtinFiles = getBuiltinFiles()
  const sandpackFiles: Record<string, string> = { ...builtinFiles }

  if (shim?.origin && shim?.dbToken) {
    sandpackFiles['/db-token-shim.ts'] = sandpackDbTokenShim(shim.origin, shim.dbToken)
    const indexEntry = sandpackFiles['/index.tsx']
    if (indexEntry && !indexEntry.includes("'./db-token-shim'")) {
      sandpackFiles['/index.tsx'] = `import './db-token-shim'\n${indexEntry}`
    }
  }

  for (const [rawPath, rawContent] of Object.entries(files)) {
    const path = rawPath
    if (path.endsWith('.txt') || path.endsWith('.xml') || (path.endsWith('.json') && path.includes('well-known'))) {
      continue
    }
    // Real bug found live (2026-10-19, tidemark): Next.js App Router
    // convention files (layout.tsx, sitemap.ts, robots.ts) are generated for
    // the REAL deployed app — layout.tsx in particular commonly imports
    // next/font/google, a module that only exists in a real Next.js runtime.
    // Sandpack's preview sandbox is a plain `react-ts` template with no
    // Next.js runtime at all, and these files are never the preview's entry
    // point — but buildSandpackFiles() included them anyway (no filter
    // existed), so Sandpack's own dependency walker tried to resolve
    // next/font/google, failed with "Cannot find module", and silently
    // failed the whole compile with zero error surfaced to the parent page
    // (confirmed live via Sandpack's own relayed console message). The
    // actual mechanism (confirmed by reading the self-hosted sandpack-
    // bundler fork's source, src/bundler/bundler.ts): `collectAppBarrelUsage`
    // scans every file's imports and calls `resolveAsync` on each specifier
    // for ALL provided files, not just ones reachable from the real
    // '/App.tsx' entry — so an unresolvable import in ANY generated file,
    // reachable or not, rejects that shared promise and silently fails the
    // whole compile. Extended (2026-10-20, static analysis, not yet an
    // individually-confirmed-live repro the way layout.tsx was) to the same
    // class of Next.js-only convention file carrying the identical risk:
    // route handlers and middleware import `next/server`
    // (NextRequest/NextResponse), and the image-metadata convention files
    // import `ImageResponse` from `next/og` — neither module exists in
    // Sandpack's plain react-ts template either, and none of these files is
    // ever the preview's entry point or renders anything a founder would
    // see in the preview. Skip these — they describe the real app's shell,
    // not anything the preview sandbox needs or can run. Extended again
    // (2026-10-20, static analysis, issue #1143) with the remaining official
    // App Router special-file basenames not yet covered: loading/error
    // (error.tsx is required to be a Client Component and sometimes imports
    // next/navigation)/global-error (replaces the root layout when active —
    // same <html>/<body> + possible next/font risk as layout.tsx)/not-found/
    // default (parallel routes)/template — none of these is ever reachable
    // from the preview's real entry ('/App.tsx') either.
    const basename = path.slice(path.lastIndexOf('/') + 1)
    if (
      /^(layout|sitemap|robots|middleware|instrumentation|route|opengraph-image|twitter-image|icon|apple-icon|manifest|loading|error|global-error|not-found|default|template)\.tsx?$/.test(
        basename
      )
    ) {
      continue
    }
    let content = rawContent
    if (/\.(t|j)sx?$/.test(path)) {
      try { content = sanitizeForSandpack(rawContent) } catch { content = rawContent }
    }
    // Real bug found live (2026-11-04, "me-product"): a fresh generation can
    // write its OWN /src/components/ui/*.tsx file importing from a
    // HALLUCINATED 'shadcn'/'shadcn/*' package — not a real npm package, not
    // anything this pipeline provides — e.g.
    //   import { Button as ShadcnButton } from 'shadcn'
    // Confirmed: all 5 shadcn wrapper files (button/input/card/dialog/table)
    // had this identical bug in one real generation, each shadowing the
    // real, working, self-contained builtin at the SAME path (shadcnFiles,
    // ./shadcn-bundle.ts) with a broken one — Sandpack's bundler then fails
    // the ENTIRE compile trying to resolve the fictional package (same
    // whole-compile-fails mechanism as the next/font/google case documented
    // above: an unresolvable import in ANY file rejects the shared promise).
    // Detect this exact hallucination and let the real builtin win instead
    // of overwriting it with broken content — the generated file adds
    // nothing a real founder's app needs here; the builtin already is a
    // complete, dependency-free implementation at this path.
    //
    // Generalized (overnight loop, 2026-11-07): the original fix only
    // matched the literal 'shadcn'/'shadcn/*' specifier, but the real root
    // cause isn't specific to that one package name — ANY bare import at a
    // builtin path that doesn't resolve in Sandpack crashes the whole
    // compile the same way, and the model can just as easily hallucinate
    // '@shadcn/ui', 'shadcn-ui', 'radix-ui', or any other plausible-sounding
    // package name here. Worse, this file at a builtin path is structurally
    // exempt from the SECOND loop's `fixJsxErrors()` generic bare-import
    // safety net below (`if (builtinPaths.has(path)) continue`) — that net
    // only runs on files that are NOT at a known builtin path, on the
    // assumption builtin-path content is always the known-safe original.
    // Once a generated override has already replaced that content here,
    // nothing downstream ever re-checks it. Reusing jsx-fixer's own
    // `ALLOWLISTED_PACKAGE_ROOTS` (the same real Sandpack dependency list
    // this pipeline actually declares) generalizes the shadcn-only check to
    // every hallucinated-package shape, not just this one confirmed repro.
    const isBuiltinPath = Object.prototype.hasOwnProperty.call(builtinFiles, path)
    const importsUnresolvablePackage = isBuiltinPath && hasUnresolvableBareImport(content)
    if (importsUnresolvablePackage) {
      continue
    }
    sandpackFiles[path] = content

    if (path.startsWith('/src/') && !path.includes('/App.tsx')) {
      const rootPath = path.replace(/^\/src\//, '/')
      sandpackFiles[rootPath] = content
    }
    if (path.startsWith('/src/app/') || path.startsWith('/app/')) {
      const rootPath = path.replace(/^\/src\/app\//, '/app/').replace(/^\/app\//, '/app/')
      sandpackFiles[rootPath] = content
      if (path.endsWith('/page.tsx') || path.endsWith('/page.ts')) {
        const dirPath = rootPath.replace(/\/page\.tsx?$/, '')
        if (dirPath !== '') {
          sandpackFiles[dirPath + '.tsx'] = content
        }
      }
    }
  }

  const builtinPathsForEntry = new Set(Object.keys(getBuiltinFiles()))
  const generatedPaths = Object.keys(sandpackFiles).filter(f => !builtinPathsForEntry.has(f))

  const mainFile = generatedPaths.find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || generatedPaths.find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || null

  // Real bug (#1099 item 8): a generation can produce only sibling
  // component files with no App.tsx/page.tsx anywhere -- the one thing
  // this pipeline genuinely cannot invent (mirrors company-scaffold.ts's
  // hasDeployableEntrypoint(), which treats this exact condition as "not
  // deployable yet" for the real deploy path). Previously this fell
  // through to `Object.keys(sandpackFiles)[0]` -- an arbitrary BUILTIN
  // file (shadcn/AIKit/template get spread into sandpackFiles first),
  // producing nonsense entry content and a raw babel parse error instead
  // of a clear message a founder could actually understand.
  const NO_ENTRYPOINT_FALLBACK = [
    "import React from 'react'",
    'export default function App() {',
    '  return (',
    "    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>",
    '      <div>',
    "        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>This page hasn't been generated yet</h1>",
    "        <p style={{ color: '#666' }}>No landing page content was produced for this company. Try regenerating, or check back shortly.</p>",
    '      </div>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')

  let mainCode = mainFile ? sandpackFiles[mainFile] : NO_ENTRYPOINT_FALLBACK

  mainCode = mainCode.replace(/from\s+['"]\.\/src\//g, "from './")
  mainCode = mainCode.replace(/from\s+['"]\.\/app\/page['"]/g, "from './app/page'")

  // Real bug found this run: a plain `!mainCode.includes('import React')`
  // check (the literal text) is blind to the SAME text appearing inside a
  // `//`/`/* */` comment (e.g. a leftover `// TODO: import React from
  // 'react' once we wire this up` note) rather than a real import
  // statement. That made this guard wrongly believe React was already
  // imported, so no `import React[, { hooks }] from 'react'` line ever got
  // prepended -- a generated app that genuinely uses `useState`/`useEffect`
  // etc. with no real import crashes at render with "useState is not
  // defined" the moment this guard is fooled, the same blank-preview crash
  // class this whole file's safety nets exist to prevent.
  //
  // Follow-up found this same run: masking comments alone still leaves a
  // SECOND, equally real way to fool this guard -- a landing page that
  // renders a "Quickstart"/example code snippet as a quoted or template
  // string containing the literal text "import React from 'react'" (an
  // ordinary thing for an SDK/API product page to show). That text is
  // still visible after comment-only masking, so the guard still wrongly
  // believes React is already imported. Blanking string/template-literal
  // CONTENT too (not just comments) closes this without any behavior
  // change for real code, since a real `import` statement or a real hook
  // call is never itself written inside a string literal.
  const mainCodeNoComments = mainCode ? maskCommentsAndStrings(mainCode) : mainCode
  if (mainCode && !mainCodeNoComments.includes('import React')) {
    const needsHooks = /\b(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer)\b/.test(mainCodeNoComments)
    const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
      .filter(h => mainCodeNoComments.includes(h))
    if (needsHooks) {
      mainCode = `import React, { ${hooks.join(', ')} } from 'react'\n${mainCode}`
    } else {
      mainCode = `import React from 'react'\n${mainCode}`
    }
  }

  // #1523-class bug: this used to grab the FIRST `function Name` in the
  // entire blob (wrong when a sibling helper component is declared before
  // the real root), and matched `function` only — a root component declared
  // as `const HomePage = () => {...}` with just a bare `export { HomePage }`
  // list (no `export default` anywhere, so the `!hasDefaultExport(...)`
  // guard above is true) never matched at all, leaving `/App.tsx` with NO
  // default export. Sandpack's `/index.tsx` does `import App from './App'`,
  // so that resolved to `undefined` and crashed with "Element type is
  // invalid" — the same crash class #1587/#1588, #1517/#1518 etc. already
  // fixed in sibling pipelines. detectRootComponent() handles arrow/class/
  // function declarations alike and picks the LAST JSX-returning PascalCase
  // candidate (root is conventionally last), not just the first `function`.
  //
  // Real bug found this run: a plain `!mainCode.includes('export default')`
  // check (the literal text) is blind to a renamed default export via a
  // named-export list (`export { Dashboard as default }`) — a real
  // generated-code shape. That left this guard true even though a default
  // export already exists, so a SECOND `export default <name>` got appended
  // below — two default exports in one module is a hard SyntaxError, worse
  // than the already-tracked "which name" ambiguity (#1617) since the file
  // no longer parses at all. hasDefaultExport() recognizes both forms.
  if (mainCode && !hasDefaultExport(mainCode)) {
    const detected = detectRootComponent(mainCode).name
    if (detected) {
      mainCode += `\n\nexport default ${detected}`
    }
  }

  // Real content length BEFORE any preamble is added below, so the reveal
  // timeout (lib/sandpack/setup.ts's /index.tsx) scales to what Tailwind's
  // JIT actually has to compile, not an inflated count. Set as a top-level
  // side effect so it runs when '/index.tsx' does `import App from './App'`
  // — before that file's own revealOnceStyled() call reads it.
  if (mainCode) {
    mainCode = `;(window as any).__APP_SOURCE_CHARS__ = ${mainCode.length};\n${mainCode}`
  }

  sandpackFiles['/App.tsx'] = mainCode

  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))

  // Real bug found live (#1099 item 4, "LoginIcon is not defined"): a
  // sibling generated file can genuinely define and export a local
  // (non-library) component that another file uses in JSX without ever
  // importing it — the file exists, so stubMissingLocalComponents() below
  // (which only reacts to an import specifier that doesn't resolve) never
  // sees anything wrong. Built once, before any file's own content is
  // mutated by the injection passes below, so export statements are read
  // from each file's original generated source.
  const localExportMap = buildLocalExportMap(sandpackFiles, builtinPaths)

  // #2029: a sibling component default-exported (either shape — inline
  // `export default function Name() {}`, or the equally common two-step
  // `function Name() {}` ... `export default Name;`) is invisible to
  // buildLocalExportMap()'s named-export-only regex, so the sibling-import
  // injector below never offered it — leaving a real, correctly-written
  // component's JSX usage with no import. Before #2026's catch-all existed
  // this crashed outright ("Name is not defined", confirmed live for
  // company younova's TaskList — #2021); after #2026 it's silently and
  // more dangerously masked: the catch-all can't tell this apart from a
  // truly-hallucinated name, so it stubs the real, working component to an
  // inert no-op instead of importing it. Built from each file's ORIGINAL
  // source for the same reason localExportMap is (above) — before any
  // injection pass below mutates file content.
  const localDefaultExportMap = buildLocalDefaultExportMap(sandpackFiles, builtinPaths)

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (!path.endsWith('.tsx')) continue
    if (builtinPaths.has(path)) continue

    // The safety-net injections below need a path to the builtin
    // components/ui and aikit directories THAT'S RELATIVE TO THIS FILE'S OWN
    // LOCATION, not a hardcoded './components/...' — a file already living
    // directly inside /src/components/ or /components/ (the common case for
    // any real multi-file app's sub-components, e.g.
    // /src/components/Sidebar.tsx) would otherwise get an injected import
    // resolving to /src/components/components/ui/button, which doesn't
    // exist ("Cannot find module", confirmed live 2026-10-15 across multiple
    // real apps — getBuiltinFiles() duplicates every shadcn/AIKit builtin to
    // BOTH /components/* and /src/components/*, precisely so a same-level
    // relative import always resolves correctly). A file at /App.tsx or
    // /src/App.tsx needs './components/ui/...'; a file whose OWN directory
    // is exactly .../components (not components itself — a file nested one
    // level further, e.g. .../components/sub/, is not a shape real codegen
    // here produces, so it's intentionally not special-cased) needs just
    // './ui/...' (and './aikit' instead of './components/aikit') since
    // components/ui and components/aikit are its siblings, not its children.
    const dir = path.slice(0, path.lastIndexOf('/'))
    const dirIsComponentsItself = /\/components$/.test(dir) || dir === 'components'
    const componentsPrefix = dirIsComponentsItself ? './' : './components/'

    let fixed = code
      .replace(/from ['"]@\/components\//g, "from './components/")
      .replace(/from ['"]@\/lib\//g, "from './lib/")
      .replace(/from ['"]@\//g, "from './")

    fixed = fixJsxErrors(fixed)

    // Real bug (confirmed live 2026-10-15, two real apps — "Wallify"'s
    // Hero.tsx and a second real app's Header.tsx): the MODEL ITSELF (not
    // this file's own injection logic) sometimes writes an import like
    // `from './components/aikit'` or `from './components/ui/button'` that's
    // only correct from a root-level file (/App.tsx, /src/App.tsx) — when
    // that exact literal path is hardcoded inside a file that ALREADY lives
    // inside a components/ directory (e.g. /src/components/Hero.tsx), it
    // resolves to the nonexistent .../components/components/... and crashes
    // Sandpack with "Cannot find module". This is a different code path from
    // the injection-depth fix above: that one only fires for imports THIS
    // function adds because they were MISSING; this one corrects a wrong
    // depth in an import the model already wrote, which the injection
    // guards never touch since they only act on names with no existing
    // import at all. Runs before injection so injection's "already
    // imported" checks see the corrected (not the stale) path.
    fixed = fixed.replace(
      /from\s+(['"])(\.\.?\/)*components\/(ui\/[a-z-]+|aikit)\1/g,
      (_match, quote: string, _dots: string, rest: string) => `from ${quote}${componentsPrefix}${rest}${quote}`
    )

    // Real bug found this run: unlike the mainCode/App.tsx react-import
    // check above (which masks comments/strings via
    // maskCommentsAndStrings() specifically because of this same false-
    // positive class, see #1165-era history), this per-FILE check ran
    // directly against raw `fixed` text with no masking at all — a SIBLING
    // component (never routed through the mainCode check above) using a
    // hook with no real import, but containing a string/template literal
    // that merely mentions `from 'react'` (e.g. a landing page rendering a
    // "Quickstart" code sample as text, the exact realistic shape already
    // covered for mainCode), wrongly read as "react is already imported"
    // and skipped injection entirely — "useState is not defined" at render
    // for that component, the exact blank/crashed-preview class this safety
    // net exists to prevent.
    //
    // Can't just blank-mask strings the way the mainCode check above does
    // and then look for "from 'react'" — maskCommentsAndStrings() blanks a
    // string's quote characters along with its content, so a REAL import's
    // own `'react'` specifier gets blanked just as thoroughly as a fake
    // one inside an arbitrary string, making the two indistinguishable
    // (confirmed: that approach broke 2 existing tests whose fixtures have
    // a real, already-present `import React from 'react'` line). Instead,
    // require the REAL-import shape to start a line (`^` or after a
    // newline) — a real import is always its own top-level statement; a
    // string/template literal merely containing import-like text embedded
    // mid-statement (e.g. `const sample = "import React from 'react'"`)
    // never starts a line this way.
    const hasRealReactImport = /(^|\n)\s*import\b[^\n]*\bfrom\s+['"]react['"]/.test(fixed)
    if (!hasRealReactImport) {
      const fixedNoComments = maskCommentsAndStrings(fixed)
      const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
        .filter(h => fixedNoComments.includes(h))
      if (hooks.length > 0) {
        fixed = `import React, { ${hooks.join(', ')} } from 'react'\n${fixed}`
      } else {
        fixed = `import React from 'react'\n${fixed}`
      }
    }

    // Real bug found this run: both the AIKit and shadcn auto-import safety
    // nets below decide a component is "already imported" (and so skip
    // injecting the real import) via a plain `import\s+.*\bName\b.*from\s+`
    // regex run against the WHOLE raw `fixed` text — blind to that same
    // text appearing inside a `//`/`/* */` comment (e.g. a leftover
    // `// import { Button } from './components/ui/button'` note) rather
    // than a real import statement. A generated app with such a comment, a
    // REAL `<Button>` JSX usage, and no real import had its import
    // injection wrongly skipped — "Button is not defined" at render, the
    // exact blank-preview crash class this file's safety nets exist to
    // prevent. Matching against a comment-masked view (same `maskCommentsAndStrings`
    // used by the React/hooks injection guard above) fixes this without
    // changing behavior for a file with no such comment. Re-derived fresh
    // right before each block below (rather than once, upfront) since
    // `fixed` is mutated in between by the aikit block's own injection.

    const aikitComponents = [
      'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
      'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
      'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
      'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
      'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
      'AIKitStepper', 'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
    ]
    const shadcnMap: Record<string, string[]> = {
      'ui/button': ['Button'],
      'ui/card': ['Card', 'CardHeader', 'CardContent', 'CardTitle', 'CardDescription', 'CardFooter'],
      'ui/badge': ['Badge'],
      'ui/avatar': ['Avatar', 'AvatarImage', 'AvatarFallback'],
      'ui/input': ['Input'],
      'ui/tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'],
      'ui/label': ['Label'],
      'ui/table': ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'],
      'ui/separator': ['Separator'],
      'ui/progress': ['Progress', 'CircularProgress'],
      'ui/alert': ['Alert', 'AlertTitle', 'AlertDescription'],
      'ui/dialog': ['Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter'],
      'ui/select': ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'],
      'ui/checkbox': ['Checkbox', 'RadioGroup', 'RadioGroupItem'],
      'ui/accordion': ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'],
      // This map had drifted out of sync with lib/sandpack/shadcn-bundle.ts's
      // real export surface — same shape as #1248 (AIKIT_COMPONENTS missing
      // VideoPlayer/StreamingText/MediaGallery). A model using any of these
      // without an explicit import sailed through this safety net unfixed.
      'ui/popover': ['Popover', 'PopoverTrigger', 'PopoverContent'],
      'ui/switch': ['Switch'],
      'ui/textarea': ['Textarea'],
      'ui/tooltip': ['Tooltip', 'TooltipProvider', 'TooltipTrigger', 'TooltipContent'],
      'ui/dropdown-menu': ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuSeparator'],
      'ui/scroll-area': ['ScrollArea', 'ScrollBar'],
      'ui/skeleton': ['Skeleton'],
      'ui/slider': ['Slider'],
      'ui/toast': ['Toast', 'ToastDescription', 'ToastTitle'],
    }
    const aikitModule = `${componentsPrefix}aikit`
    // #2016: every bundle path that really exports a given name. `Skeleton`
    // is exported by both bundles, so both of its paths are legitimate and
    // neither detach pass below may rewrite one into the other.
    const bundlePathsByComponent: Record<string, string[]> = {}
    for (const c of aikitComponents) {
      bundlePathsByComponent[c] = [...(bundlePathsByComponent[c] || []), aikitModule]
    }
    for (const [mod, components] of Object.entries(shadcnMap)) {
      for (const c of components) {
        bundlePathsByComponent[c] = [...(bundlePathsByComponent[c] || []), `${componentsPrefix}${mod}`]
      }
    }

    {
      // #2016: detach a used component from a wrong-bundle import first, so
      // the "already imported" check just below can't be fooled by it.
      for (const c of aikitComponents) {
        if (new RegExp(`<${c}[\\s/>]`).test(maskCommentsAndStrings(fixed))) {
          fixed = detachFromWrongPathImport(fixed, c, bundlePathsByComponent[c])
        }
      }
      const fixedNoComments = maskCommentsAndStrings(fixed)
      const usedAikit = aikitComponents.filter(c =>
        new RegExp(`<${c}[\\s/>]`).test(fixedNoComments) &&
        !new RegExp(`import\\s+.*\\b${c}\\b.*from\\s+`).test(fixedNoComments)
      )
      if (usedAikit.length > 0) {
        fixed = `import { ${usedAikit.join(', ')} } from '${aikitModule}'\n${fixed}`
      }
    }

    {
      const imports: string[] = []
      // #2016: same wrong-bundle-import blind spot as the AIKit guard above
      // — detach a used component from any import whose path isn't a bundle
      // that really exports it, so an import of the right name from the
      // wrong shadcn submodule doesn't defeat the correction below.
      for (const components of Object.values(shadcnMap)) {
        for (const c of components) {
          if (new RegExp(`<${c}[\\s/>]`).test(maskCommentsAndStrings(fixed))) {
            fixed = detachFromWrongPathImport(fixed, c, bundlePathsByComponent[c])
          }
        }
      }
      const fixedNoComments = maskCommentsAndStrings(fixed)
      for (const [mod, components] of Object.entries(shadcnMap)) {
        const used = components.filter(c =>
          // #1165: was `<${c}[\\s/>]|\\b${c}\\b` — the bare `\b${c}\b`
          // fallback matched plain English prose containing the component
          // name as an ordinary word (confirmed live: "Select mild,
          // medium, or wild" in a founder's own copy text spuriously
          // injected `import { Select } from './components/ui/select'`,
          // a real, unused import with nothing to do with JSX at all).
          // Only the real JSX-tag-opening pattern is a legitimate signal
          // this component is actually rendered — matches the AIKit
          // injection guard just below, which never had this bug.
          // Matched against a comment-masked view (see block comment
          // above the AIKit guard) so a leftover `// import { X } from
          // ...'` note can't fool the "already imported" half of this
          // check either.
          new RegExp(`<${c}[\\s/>]`).test(fixedNoComments) &&
          !new RegExp(`import\\s+.*\\b${c}\\b.*from\\s+`).test(fixedNoComments)
        )
        if (used.length > 0) {
          imports.push(`import { ${used.join(', ')} } from '${componentsPrefix}${mod}'`)
        }
      }
      if (imports.length > 0) {
        fixed = imports.join('\n') + '\n' + fixed
      }
    }

    // Real bug (confirmed live 2026-10-15): this used to be gated behind
    // `if (!fixed.includes("from 'lucide-react'"))`, so a file that already
    // imports SOME lucide icons (e.g. `import { Tag } from 'lucide-react'`)
    // but uses another one the model forgot (e.g. `icon: Shield` inside an
    // object literal) never got that missing icon injected at all — the
    // guard assumed "has a lucide import" means "has everything it needs,"
    // which isn't true when the model's own import list is incomplete.
    // Compute missing icons unconditionally; merge into the existing import
    // statement when one exists, otherwise add a new one, same as the
    // shadcn/AIKit injections above already do.
    //
    // Second real bug, same block (overnight loop, 2026-11-08): the
    // `missingIcons` detection below was the one check in this function
    // left testing raw `fixed` instead of a comment/string-masked view —
    // the AIKit block (above) and the shadcn block (below) both already
    // switched to `maskCommentsAndStrings(fixed)` for exactly this reason.
    // A sibling file's comment like `// e.g. <Shield className="h-4 w-4" />`
    // or `// uses icon: Settings for the config page` matches this block's
    // own `<${icon}[\s/>]` / `icon:\s*${icon}` patterns against the raw
    // text, wrongly judging the icon "used" and injecting an unused
    // `import { Shield } from 'lucide-react'`. Masking closes the same gap
    // here that #1165's own doc comment (below) already fixed for the
    // bare-word-in-prose variant of this check.
    {
      const allLucideIcons = [
        'Activity', 'AlertCircle', 'AlertTriangle', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
        'Award', 'BarChart', 'BarChart2', 'BarChart3', 'Bell', 'Book', 'BookOpen', 'Bot',
        'Brain', 'Briefcase', 'Calendar', 'Camera', 'Check', 'CheckCircle', 'CheckCircle2',
        'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp', 'Circle', 'CircleDot', 'Clock', 'Cloud',
        'Code', 'Code2', 'Cog', 'Command', 'Copy', 'CreditCard', 'Crown',
        'Database', 'DollarSign', 'Download', 'Edit', 'Edit2', 'Edit3', 'ExternalLink', 'Eye', 'EyeOff',
        'Facebook', 'File', 'FileText', 'Filter', 'Flag', 'Flame', 'Folder', 'FolderOpen',
        'Gift', 'Github', 'Globe', 'Grid', 'Grip', 'Hash', 'Headphones', 'Heart', 'HelpCircle', 'Home',
        'Image', 'Inbox', 'Info', 'Instagram', 'Key', 'Laptop', 'Layout', 'LayoutDashboard',
        'Layers', 'Library', 'Lightbulb', 'LineChart', 'Link', 'Linkedin', 'List', 'Loader', 'Loader2',
        'Lock', 'LogIn', 'LogOut', 'Mail', 'Map', 'MapPin', 'Maximize', 'Maximize2',
        'Menu', 'MessageCircle', 'MessageSquare', 'Mic', 'Minimize', 'Minimize2', 'Minus', 'Monitor',
        'Moon', 'MoreHorizontal', 'MoreVertical', 'Mountain', 'MousePointer', 'Music', 'Navigation',
        'Package', 'Palette', 'Paperclip', 'Pause', 'PenTool', 'Percent', 'Phone', 'PieChart',
        'Pin', 'Play', 'PlayCircle', 'Plus', 'PlusCircle', 'Podcast', 'Power',
        'Printer', 'QrCode', 'Quote', 'Radio', 'RefreshCw', 'Repeat', 'Reply', 'Rocket',
        'RotateCcw', 'RotateCw', 'Rss', 'Save', 'Scale', 'Scan', 'Search', 'Send', 'Server',
        'Settings', 'Settings2', 'Share', 'Share2', 'Shield', 'ShieldCheck', 'ShoppingBag',
        'ShoppingCart', 'Shuffle', 'Sidebar', 'Signal', 'Slack', 'Sliders', 'Smartphone',
        'Smile', 'Sparkle', 'Sparkles', 'Speaker', 'Square', 'Star', 'Sun', 'Sunrise', 'Sunset',
        'Swords', 'Table', 'Tablet', 'Tag', 'Target', 'Terminal', 'ThumbsDown', 'ThumbsUp',
        'Timer', 'ToggleLeft', 'ToggleRight', 'Tool', 'Trash', 'Trash2', 'TrendingDown', 'TrendingUp',
        'Triangle', 'Trophy', 'Truck', 'Tv', 'Twitter', 'Type', 'Umbrella', 'Underline',
        'Undo', 'Unlock', 'Upload', 'UploadCloud', 'User', 'UserCheck', 'UserMinus', 'UserPlus',
        'Users', 'Video', 'Volume', 'Volume1', 'Volume2', 'VolumeX', 'Wallet', 'Wand', 'Wand2',
        'Watch', 'Wifi', 'WifiOff', 'Wind', 'Wrench', 'X', 'XCircle', 'Youtube', 'Zap', 'ZoomIn', 'ZoomOut',
      ]
      // An icon already present in SOME existing lucide-react import
      // statement (any quote style) doesn't need to be injected again —
      // only truly missing icons do.
      //
      // Real bug (overnight loop, #1891): this used to match raw `fixed`
      // directly, so a stale commented-out `// import { Zap } from
      // 'lucide-react'` line made a REAL, uncommented `<Zap />` usage look
      // "already imported" and skipped injecting the real import entirely
      // — "Zap is not defined" at render, the exact crash class this
      // safety net exists to prevent (worse than an unused-import false
      // positive, since the real import never lands at all). Can't just
      // run this against `maskCommentsAndStrings(fixed)` the way the
      // AIKit/shadcn "already imported" checks do — that also blanks the
      // `'lucide-react'` string literal's content, so even a REAL import
      // would stop matching (same gotcha already documented above for the
      // React-import check). Instead, same fix as that React-import check:
      // require the import to be its own statement starting a line — a
      // `//`-prefixed comment line never satisfies that.
      const existingImportMatch = fixed.match(
        /(?:^|\n)[ \t]*(import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"])/
      )
      const alreadyImported = new Set(
        (existingImportMatch?.[2] ?? '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      )
      // #1165: was a bare `\b${icon}\b` anywhere in the file — matched the
      // icon name as an ordinary English word in prose/JSX text content,
      // object keys, or unrelated identifiers with zero connection to an
      // actual icon usage (confirmed live, habanero-hub: "Gift
      // Subscriptions" link text, a "Jalapeño Sunrise" flavor name, the
      // "Navigation" JSX comment, "Content-Type" header strings, and
      // "Key features"/"Reorder & Share" copy each spuriously injected
      // Gift/Sunrise/Navigation/Type/Key/Share into the lucide-react
      // import, even though none was ever actually rendered). Real usage
      // is either a JSX tag (`<Icon`) or the documented `icon: Icon` /
      // `icon={Icon}` object-property-reference pattern (see this
      // injection's own doc comment above, written for exactly that case)
      // — require one of those, not a bare word appearing anywhere.
      // 'Tool' was renamed to 'Wrench' upstream and isn't a real export of
      // either this repo's own lucide-react or the older version pinned for
      // Sandpack preview rendering (sandpack-preview.tsx's customSetup.
      // dependencies) — confirmed against both packages' actual exports.
      // JSX still using `<Tool />` (a plausible model guess for a
      // wrench/settings icon) needs the real export aliased back to the
      // name the JSX already uses, not a literal `{ Tool }` import, which
      // resolves to undefined and crashes the render ("Element type is
      // invalid").
      const iconImportAliases: Record<string, string> = { Tool: 'Wrench' }
      //
      // Matched against `maskCommentsAndStrings(fixed)`, not raw `fixed`
      // (see this block's doc comment above) — a comment containing
      // `<Shield className=...` or `icon: Settings` still looks like real
      // usage to the `<Icon[\s/>]` / `icon:\s*Icon` patterns above even
      // though #1165 already narrowed them past bare-word prose matches.
      const fixedNoComments = maskCommentsAndStrings(fixed)
      const missingIcons = allLucideIcons.filter(icon =>
        new RegExp(`<${icon}[\\s/>]|\\bicon:\\s*${icon}\\b|\\bicon=\\{${icon}\\}`).test(fixedNoComments) &&
        !alreadyImported.has(icon)
      )
      const toSpecifier = (icon: string) =>
        iconImportAliases[icon] ? `${iconImportAliases[icon]} as ${icon}` : icon
      if (missingIcons.length > 0) {
        if (existingImportMatch) {
          const merged = [...alreadyImported, ...missingIcons.map(toSpecifier)].join(', ')
          fixed = fixed.replace(existingImportMatch[1], `import { ${merged} } from 'lucide-react'`)
        } else {
          fixed = `import { ${missingIcons.map(toSpecifier).join(', ')} } from 'lucide-react'\n${fixed}`
        }
      }
    }

    // Inject a missing import for a locally-defined sibling component used
    // in JSX but never imported (see localExportMap comment above). Grouped
    // by source file so multiple names from the same sibling become one
    // import statement, same as the shadcn injection above.
    //
    // Real bug (overnight loop, #1891): both checks below used to test raw
    // `fixed` directly, same gap as the AIKit/shadcn blocks above had before
    // their own fix — a comment-only `<Name />` mention or a stale
    // commented-out `// import { Name } from './Sibling'` line is
    // indistinguishable from the real thing. Unlike the lucide
    // "already-imported" check just above, neither regex here matches into
    // a string literal's content, so matching against
    // `maskCommentsAndStrings(fixed)` (same technique as AIKit/shadcn) is
    // safe and doesn't need the line-start-anchor workaround.
    {
      const selfPath = normalizeForRelative(path)
      const fixedNoComments = maskCommentsAndStrings(fixed)
      const byFile = new Map<string, string[]>()
      for (const [name, exportingPath] of localExportMap) {
        if (exportingPath === selfPath) continue
        if (!new RegExp(`<${name}[\\s/>]`).test(fixedNoComments)) continue
        if (
          new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(fixedNoComments) ||
          new RegExp(`import\\s+${name}\\b`).test(fixedNoComments)
        ) continue
        const rel = relativeImportPath(path, exportingPath)
        if (!byFile.has(rel)) byFile.set(rel, [])
        byFile.get(rel)!.push(name)
      }
      if (byFile.size > 0) {
        const importLines = Array.from(byFile.entries()).map(
          ([rel, names]) => `import { ${names.join(', ')} } from '${rel}'`
        )
        fixed = importLines.join('\n') + '\n' + fixed
      }

      // #2029: same injection, for a sibling used in JSX but only
      // DEFAULT-exported — a plain named `import { Name }` would itself
      // crash ("does not provide an export named 'Name'"), so this needs
      // its own default-import line, kept one-per-file since a default
      // export is exactly one binding (unlike the named case above, which
      // can group several names from the same file onto one line).
      const defaultImportLines: string[] = []
      for (const [name, exportingPath] of localDefaultExportMap) {
        if (exportingPath === selfPath) continue
        if (localExportMap.has(name)) continue // named export already wins above
        if (!new RegExp(`<${name}[\\s/>]`).test(fixedNoComments)) continue
        if (
          new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(fixedNoComments) ||
          new RegExp(`import\\s+${name}\\b`).test(fixedNoComments)
        ) continue
        const rel = relativeImportPath(path, exportingPath)
        defaultImportLines.push(`import ${name} from '${rel}'`)
      }
      if (defaultImportLines.length > 0) {
        fixed = defaultImportLines.join('\n') + '\n' + fixed
      }
    }

    // Catch-all (#2026): a bare capitalized JSX tag with NO import statement
    // for it anywhere in the file and no local declaration, that survived
    // every name-specific safety net above (AIKit/shadcn/lucide icons/local
    // siblings) because it isn't a real AIKit/shadcn/lucide/sibling name at
    // all — a wholly invented identifier the model hallucinated. Confirmed
    // live: company 'revela', Navbar.tsx's `<MenuIcon/>`/`<XIcon/>` (the
    // DEFAULT branch of a ternary, rendered unconditionally — not a
    // conditional-only path) and HowItWorks.tsx's `<LoginIcon/>`/
    // `<AnalyticsIcon/>`/`<LightningIcon/>`. None of these exist in
    // lucide-react (whose real names for the same concepts are `X`, `Menu`,
    // `LogIn`, etc., with no `Icon` suffix) or any other known-name list
    // this file maintains, so every net above correctly declines to touch
    // them — each one only reacts to a name it specifically recognizes.
    // Left alone, this throws "X is not defined" the instant React renders
    // the component, crashing the whole preview exactly like the missing-
    // sibling-FILE case `stubMissingLocalComponents()` already guards
    // against below — this is the same gap one level up, for a missing
    // sibling IDENTIFIER with no import line at all to anchor a path-based
    // fix to. Mirrors that function's "degrade to an inert stub, never take
    // down the whole preview" philosophy: synthesize a trivial local inert
    // declaration right in this file for any such name, so the component
    // simply renders nothing instead of throwing.
    //
    // Deliberately conservative — never fires for a name this pass can't be
    // sure is genuinely undeclared:
    //  - Only bare tags (`<Name` followed by whitespace/`/`/`>`), never a
    //    member-expression tag (`<Foo.Bar>`) — `Foo` there is very likely a
    //    namespace import/object already handled (or not) by other logic,
    //    not this shape.
    //  - Checked against a loose `import\s+.*\bName\b.*from\s+` test (same
    //    "already imported" pattern the AIKit/shadcn/lucide/sibling nets
    //    above already use) — ANY import statement mentioning the name at
    //    all is enough to skip it, so this only ever fires on a name with
    //    truly zero import line.
    //  - Checked against a local-declaration test covering function/class/
    //    const/let/var declarations AND destructuring (`const { Name }`,
    //    function-parameter destructuring `({ Name }) =>`) and import-like
    //    aliasing — matching completeness-gate.ts's own
    //    collectKnownIdentifiers()'s declaration shapes plus destructuring,
    //    deliberately erring toward treating more things as "already
    //    declared" (and skipping) rather than risking a duplicate
    //    declaration, which would introduce a real
    //    "has already been declared" SyntaxError strictly worse than the
    //    original bug.
    //  - Runs against a comment/string-masked view throughout (same
    //    `maskCommentsAndStrings` used by every other injector in this
    //    function) so a merely-mentioned name inside a comment/string can
    //    never trigger or suppress this.
    {
      const fixedNoComments = maskCommentsAndStrings(fixed)
      const tagNames = new Set<string>()
      for (const m of fixedNoComments.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)) {
        tagNames.add(m[1])
      }
      const toDeclare: string[] = []
      for (const name of tagNames) {
        if (KNOWN_GLOBAL_JSX_NAMES.has(name)) continue
        const alreadyImported = new RegExp(`import\\s+.*\\b${name}\\b.*from\\s+`).test(fixedNoComments)
        if (alreadyImported) continue
        const locallyDeclared = new RegExp(
          `(?:^|[\\n;{(\\s])(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function|class)\\s+${name}\\b` +
            `|(?:^|[\\n;{(\\s])(?:export\\s+)?(?:const|let|var)\\s+${name}\\b` +
            `|[{,]\\s*${name}\\s*(?:[,}:]|\\s+as\\b)`,
        ).test(fixedNoComments)
        if (locallyDeclared) continue
        toDeclare.push(name)
      }
      if (toDeclare.length > 0) {
        const decls = toDeclare.map(
          (name) => `const ${name} = (props) => (props && props.children) || null;`,
        )
        fixed = decls.join('\n') + '\n' + fixed
      }
    }

    try { fixed = sanitizeForSandpack(fixed) } catch { /* keep fixed as-is */ }

    sandpackFiles[path] = fixed
  }

  fixMissingExports(sandpackFiles)
  fixExportShapeMismatches(sandpackFiles)
  stubMissingLocalComponents(sandpackFiles)
  fixNativeDialogCalls(sandpackFiles)

  return sandpackFiles
}

/**
 * Real bug found live (#1559, `huddle`): a generated handler's native,
 * synchronous `alert()`/`confirm()`/`prompt()` call blocks the calling
 * thread until dismissed. In the real `/build` preview iframe this reads as
 * a frozen, unresponsive tab the instant a founder clicks the control that
 * calls it — confirmed live by clicking `huddle`'s real "Get Early Access"
 * button, which froze all further interaction until the native dialog was
 * dismissed. It's also a trust/polish problem independent of the freeze: a
 * native browser dialog box on an otherwise professionally-styled page
 * reads as broken, not as a real working feature.
 *
 * A live confirmed query found 82 generations using `alert()` somewhere in
 * their code — a recurring content-generation pattern, not an isolated
 * incident. Regenerating all of them isn't realistic; this rewrites the
 * calls in-place for the preview the same way the other safety nets in this
 * file repair generation gaps without needing a regeneration.
 *
 * Each matched call is rewritten to a same-signature, non-blocking shim
 * defined once at the top of the file: `alert` fires a console message
 * instead of a modal, `confirm` returns `true` (the dialog never actually
 * blocks on a real answer, so proceeding is the least-surprising default —
 * matches what a real founder clicking through their own happy path would
 * expect), and `prompt` returns its default-value argument (or `''`). A
 * negative lookbehind keeps this from matching a method call on some other
 * object (e.g. a notification library's own `toast.alert(...)`) — only a
 * bare `alert(`/`window.alert(` call (and the `confirm`/`prompt` siblings)
 * is rewritten.
 *
 * #1559 follow-up: the IDENTICAL fix was also ported into
 * lib/code-validator.ts's autoFixCode() (called by sanitizeForSandpack(),
 * which THIS pipeline already runs earlier via buildSandpackFiles() — see the
 * `sanitizeForSandpack(fixed)` calls above) for the single-file Babel preview
 * path, which this Sandpack-only fix never covered (confirmed live:
 * `flipsight` still hung after this landed, since it renders single-file, not
 * Sandpack). Both now use the SAME `__previewSafe*` shim names on purpose —
 * sanitizeForSandpack() already neutralizes any dialog call before this
 * function ever runs, so in practice this loop is usually a no-op for
 * Sandpack too; it's kept as a second, independent safety net (same
 * philosophy as the other fixers in this pipeline) rather than relying on a
 * single call path, and the shared naming means output is identical no
 * matter which pass actually did the rewrite.
 */
function fixNativeDialogCalls(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const dialogCallRe = /(?<![.\w$])(?:window\.)?(alert|confirm|prompt)\s*\(/
  const globalDialogCallRe = /(?<![.\w$])(?:window\.)?(alert|confirm|prompt)\s*\(/g
  // Real bug found live (shoplo repair, 2026-11-04): a stored generation can
  // ALREADY call __previewSafeAlert/__previewSafeConfirm/__previewSafePrompt
  // directly (e.g. a repair pass, or a generation saved before this pipeline
  // ran on it) without a raw alert()/confirm()/prompt() left to rewrite — the
  // old `if (!dialogCallRe.test(code)) continue` guard skipped those files
  // entirely, so the shim function definitions were never injected and the
  // call crashed at runtime with "X is not defined", even though
  // lib/code-validator.ts's parse gate (#1780) correctly allowlists the name
  // as a known global. Detect an already-rewritten call the same way.
  const shimCallRe = /(?<![.\w$])__previewSafe(Alert|Confirm|Prompt)\s*\(/
  const shimDefRe = /function\s+__previewSafe(?:Alert|Confirm|Prompt)\s*\(/

  const SHIM = [
    "function __previewSafeAlert(message) { if (typeof console !== 'undefined') console.info('[preview alert]', message) }",
    "function __previewSafeConfirm(message) { if (typeof console !== 'undefined') console.info('[preview confirm]', message); return true }",
    "function __previewSafePrompt(message, defaultValue) { if (typeof console !== 'undefined') console.info('[preview prompt]', message); return defaultValue !== undefined ? defaultValue : '' }",
  ].join('\n')

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (!/\.(t|j)sx?$/.test(path)) continue
    if (builtinPaths.has(path)) continue

    // Real bug found live: these three decisions used to run against raw
    // `code`, blind to a `//`/`/* */` comment that merely *mentions*
    // alert()/__previewSafeAlert(/the shim's own `function` signature
    // (e.g. a leftover draft note). maskCommentsAndStrings() preserves
    // exact character offsets, so the actual rewrite below can still
    // splice into the ORIGINAL `code` at the offsets found here, rather
    // than risk the replace() itself mutating comment text.
    const maskedCode = maskCommentsAndStrings(code)
    const hasRawDialogCall = dialogCallRe.test(maskedCode)
    const hasShimCall = shimCallRe.test(maskedCode)
    if (!hasRawDialogCall && !hasShimCall) continue
    // Already has its own local shim definition (e.g. a second pass over
    // the same file) — nothing to inject, rewriting raw calls (if any) is
    // still safe and handled below.
    const alreadyDefined = shimDefRe.test(maskedCode)

    let fixed = code
    if (hasRawDialogCall) {
      const re = new RegExp(globalDialogCallRe.source, globalDialogCallRe.flags)
      let cursor = 0
      let out = ''
      let m: RegExpExecArray | null
      while ((m = re.exec(maskedCode))) {
        const start = m.index
        const end = start + m[0].length
        const fn = m[1]
        const capitalized = fn.charAt(0).toUpperCase() + fn.slice(1)
        out += code.slice(cursor, start) + `__previewSafe${capitalized}(`
        cursor = end
      }
      out += code.slice(cursor)
      fixed = out
    }

    if (alreadyDefined) {
      sandpackFiles[path] = fixed
      continue
    }

    // A leading "use client"/"use strict" directive must stay the very
    // first statement in the file — insert the shim just after it instead
    // of before, so the directive is never displaced from position 0.
    const directiveMatch = fixed.match(/^(['"]use (?:client|strict)['"];?\s*\n)/)
    sandpackFiles[path] = directiveMatch
      ? directiveMatch[1] + SHIM + '\n' + fixed.slice(directiveMatch[1].length)
      : SHIM + '\n' + fixed
  }
}

/**
 * Real bug class matching "Element type is invalid" (#1539, silo-product):
 * a sibling component file genuinely EXISTS and genuinely DEFINES the
 * requested identifier as a top-level `function Name(...)` / `const Name =`
 * / `class Name` — but the generation never wrote an `export` keyword on it
 * at all. Confirmed live: silo-product's App.tsx does
 * `import SiloList from './components/SiloList'` and SiloList.tsx genuinely
 * defines `function SiloList({ ... }) { ... }`, with zero occurrences of the
 * word "export" anywhere in the file. The import specifier resolves (the
 * file exists), so stubMissingLocalComponents() — which only reacts to a
 * specifier matching NO file at all — never fires. And
 * fixExportShapeMismatches() (below) only REDIRECTS between an existing
 * default export and an existing named export; a file with NEITHER has
 * nothing for it to redirect to, so that safety net's two branches also
 * both silently decline. The result: neither existing safety net catches
 * this, and `<SiloList/>` throws exactly "Element type is invalid: ...
 * got: undefined" — the component was real, present, and fully-written;
 * it just forgot to say `export`.
 *
 * Fix: for each relative import, if the target file defines (but doesn't
 * export) a top-level declaration whose name matches what the import
 * clause actually asks for (a bare default import's local identifier, or
 * a named import's specifier), prepend the word `export` directly onto
 * that declaration line — the identifier is exactly what a real
 * generation almost certainly meant to export, so adding the export is
 * the correct, minimal repair, not a guess. Deliberately produces the
 * SAME `export (const|function|class) Name` shape fixExportShapeMismatches'
 * own shapeOf() already recognizes (not a separate `export { Name }`
 * re-export line, which that function's shape-detection regex does not
 * match) — runs BEFORE fixExportShapeMismatches so a file fixed here
 * already has a real, correctly-detected matching export shape by the
 * time that pass looks at it and rewrites the IMPORTING file's clause to
 * match (nothing left for it to redirect, it just reads the shape).
 *
 * Deliberately conservative: only matches a clause asking for an
 * identifier that is unambiguously defined (exactly once) in the target
 * file and not already exported under any name — never invents a new
 * identifier, never touches a file with a genuine naming mismatch.
 */
function fixMissingExports(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const importRe = /^[ \t]*import\s+([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm
  // Captures the exact unexported declaration line so it can be rewritten
  // in place (group 1: leading whitespace, group 2: function|class|const).
  const declRe = (name: string) => new RegExp(`^([ \\t]*)(function|class|const)\\s+${name}\\b`, 'm')
  const alreadyExportedRe = (name: string) =>
    new RegExp(`export\\s+(?:default\\s+)?(?:function|class|const)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`)

  function resolveTargetPath(resolved: string): string | null {
    const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}/index.tsx`, `${resolved}/index.ts`]
    return candidates.find((c) => c in sandpackFiles) ?? null
  }

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const clause = match[1].trim()
      if (/^type\s/.test(clause)) continue
      const resolved = resolveRelativeImport(dir, match[2])
      if (!resolved) continue
      const targetPath = resolveTargetPath(resolved)
      if (!targetPath) continue // genuinely missing — stubMissingLocalComponents' job

      const wanted: string[] = []
      const bareDefault = clause.match(/^([A-Za-z_$][\w$]*)$/)
      if (bareDefault) wanted.push(bareDefault[1])
      const namedList = clause.match(/^\{([^}]*)\}$/)
      if (namedList) {
        for (const part of namedList[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/)[0].trim()
          if (name) wanted.push(name)
        }
      }

      for (const name of wanted) {
        const targetCode = sandpackFiles[targetPath]
        // #1919: both checks below run against a comment/string-masked view
        // of the target file — a comment merely MENTIONING an export shape
        // (an old draft's `export { Name}` kept "for reference") must never
        // read as a real export, and the declaration this rewrites must
        // never be a decoy sitting inside a comment, or the genuinely
        // unexported declaration elsewhere in the file stays unexported.
        const maskedTarget = maskCommentsAndStrings(targetCode)
        if (alreadyExportedRe(name).test(maskedTarget)) continue
        const declMatch = maskedTarget.match(declRe(name))
        if (!declMatch || declMatch.index === undefined) continue
        const start = declMatch.index
        const end = start + declMatch[0].length
        sandpackFiles[targetPath] =
          targetCode.slice(0, start) + `${declMatch[1]}export ${declMatch[2]} ${name}` + targetCode.slice(end)
      }
    }
  }
}

/**
 * Real bug class matching "Element type is invalid": a sibling component
 * file genuinely EXISTS and its import specifier resolves fine, but the
 * importing file requests the WRONG export shape — a bare default import
 * (`import Footer from './components/Footer'`) of a file that only exports
 * a NAMED `Footer` (`export const Footer = ...`), or the inverse
 * (`import { Footer } from './components/Footer'` of a file that only has
 * `export default function Footer()`). Neither case throws at parse time —
 * the specifier resolves, the file exists — but the imported binding is
 * `undefined` at runtime, so `<Footer/>` throws exactly "Element type is
 * invalid: ... got: undefined", indistinguishable to the user from a
 * genuinely missing component. None of this file's other safety nets catch
 * it: stubMissingLocalComponents() only reacts to a specifier that doesn't
 * resolve to any file at all, and the missing-local-export injector above
 * only ever ADDS a brand-new import — it never corrects an EXISTING one.
 *
 * Deliberately conservative — only rewrites the single-binding, unambiguous
 * shape (no mixed `import Foo, { Bar }` clauses): a bare default import
 * whose identifier exactly matches one of the target's real named exports,
 * or a single named import whose specifier the target does NOT export by
 * name but DOES export as its default. A genuinely missing/misspelled
 * export (neither shape matches) is left alone rather than guessed at.
 */
function fixExportShapeMismatches(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const importRe = /^[ \t]*import\s+([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm

  const shapeCache = new Map<string, { hasDefault: boolean; named: Set<string>; defaultRhs: string | null } | null>()
  function shapeOf(resolved: string): { hasDefault: boolean; named: Set<string>; defaultRhs: string | null } | null {
    if (shapeCache.has(resolved)) return shapeCache.get(resolved)!
    const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}/index.tsx`, `${resolved}/index.ts`]
    const real = candidates.find((c) => c in sandpackFiles)
    // #1919: hasDefault/named/defaultRhs all read a comment/string-masked
    // view — a comment merely MENTIONING "export default Name" or "export
    // const Name" (an old approach kept "for reference") must never read as
    // a real export shape, or this misjudges whether a sibling import needs
    // rewriting and can turn a working import into an `undefined` binding.
    const maskedReal = real ? maskCommentsAndStrings(sandpackFiles[real]) : null
    const defaultRhsMatch = maskedReal ? maskedReal.match(/export\s+default\s+([^\n;]*)/) : null
    const shape = real
      ? {
          hasDefault: /export\s+default\b/.test(maskedReal!),
          named: new Set([
            ...[...maskedReal!.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)].map(
              (m) => m[1],
            ),
            ...extractBareExportListNames(sandpackFiles[real]),
          ]),
          defaultRhs: defaultRhsMatch ? defaultRhsMatch[1].trim() : null,
        }
      : null
    shapeCache.set(resolved, shape)
    return shape
  }

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    const edits: { from: string; to: string }[] = []
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const clause = match[1].trim()
      if (/^type\s/.test(clause)) continue
      const resolved = resolveRelativeImport(dir, match[2])
      if (!resolved) continue
      const shape = shapeOf(resolved)
      if (!shape) continue // genuinely missing — stubMissingLocalComponents' job

      const bareDefault = clause.match(/^([A-Za-z_$][\w$]*)$/)
      if (bareDefault && !shape.hasDefault && shape.named.has(bareDefault[1])) {
        const name = bareDefault[1]
        const replaced = match[0].replace(new RegExp(`import\\s+${name}\\b`), `import { ${name} }`)
        if (replaced !== match[0]) edits.push({ from: match[0], to: replaced })
        continue
      }

      const singleNamed = clause.match(/^\{\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}$/)
      if (singleNamed) {
        const exported = singleNamed[1]
        const local = singleNamed[2] || singleNamed[1]
        if (!shape.named.has(exported) && shape.hasDefault && defaultExportIsSuitableSingleTarget(shape.defaultRhs, exported)) {
          const aliasPart = singleNamed[2] ? `\\s+as\\s+${local}` : ''
          const replaced = match[0].replace(new RegExp(`\\{\\s*${exported}(?:${aliasPart})?\\s*\\}`), local)
          if (replaced !== match[0]) edits.push({ from: match[0], to: replaced })
        }
      }
    }
    if (edits.length > 0) {
      let fixed = code
      for (const { from, to } of edits) fixed = fixed.replace(from, to)
      sandpackFiles[path] = fixed
    }
  }
}

/**
 * Real gap found live (overnight loop static analysis, #1539 — "Element
 * type is invalid ... but got: object" on silo-product's cold load):
 * `fixExportShapeMismatches()`'s `singleNamed` branch used to treat ANY
 * `export default` text in a target file as proof the default export IS
 * the single named component being imported — it never checked what the
 * default export's own value actually is.
 *
 * Two shapes make that assumption wrong:
 *  - `export default { Footer }` — a plain OBJECT literal referencing the
 *    component (a plausible model mistake, confusing object-shorthand
 *    export with re-exporting the component itself). `shape.hasDefault`
 *    reads true, there's no real named export either, so the old code
 *    rewrote `import { Footer } from './Footer'` (correctly resolves to
 *    `undefined` per real ES semantics — already broken, but at least
 *    throws the FAMILIAR "got: undefined" message) into `import Footer
 *    from './Footer'`, which binds `Footer` to the whole object, not the
 *    function — rendering `<Footer/>` then throws "Element type is
 *    invalid ... but got: object" instead. The "fix" changed the crash
 *    signature, it didn't fix anything.
 *  - `export default SomethingElse` — a bare reference to a genuinely
 *    DIFFERENT identifier than the one being imported. "Has a default" is
 *    not "is the thing being imported by this other name."
 *
 * Deliberately permissive otherwise (unnamed/anonymous `export default
 * function () {...}` or `export default class {...}`, or a bare reference
 * that DOES match the requested name) — those are exactly the safe shapes
 * this correction exists to handle, same conservative philosophy as the
 * rest of this function's own doc comment.
 */
function defaultExportIsSuitableSingleTarget(defaultRhs: string | null, exported: string): boolean {
  if (defaultRhs === null) return true
  if (defaultRhs.startsWith('{') || defaultRhs.startsWith('[')) return false
  const bareRef = defaultRhs.match(/^([A-Za-z_$][\w$]*)\s*;?\s*$/)
  if (bareRef && bareRef[1] !== exported) return false
  return true
}

/**
 * Real bug found live (2026-10-20, Dispatch): a generated app's own files
 * can import a sibling component that the generation genuinely never
 * produced (confirmed: /src/App.tsx imports './components/Footer', but no
 * Footer.tsx exists anywhere in the real files map returned by
 * /api/generation/{chatId}/files — a content-generation gap, not a path-
 * resolution bug the existing shadcn/lucide/AIKit safety nets above cover).
 * Sandpack's bundler fails the ENTIRE preview with "Cannot find module" for
 * this one missing file, even though every OTHER component rendered fine.
 *
 * Mirrors the existing safety-net philosophy in this file: a generation gap
 * must degrade gracefully, never take down the whole preview. Scans every
 * non-builtin file for a relative import (`./X`, `./components/X`, `../X`)
 * whose resolved path has no matching key in sandpackFiles, and synthesizes
 * an inert stub component at that exact path — so the import resolves, the
 * rest of the app renders, and the ONLY visible gap is the specific missing
 * section (rendering nothing) rather than the entire page crashing.
 *
 * Deliberately conservative: only synthesizes a stub for a path that is
 * genuinely absent after every real pass above (builtins, shadcn/AIKit
 * injection, de-dupe) has already run — a real file at that path always
 * wins, this never overwrites one.
 */
function stubMissingLocalComponents(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  // Captures the import clause too (not just the path) — #1122's original
  // version only tracked WHICH paths were missing, not WHAT each importer
  // actually needed from them. See needsDefault/namedExports below.
  const importRe = /^[ \t]*import\s+(?:type\s+)?([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm

  // Collect candidate missing paths first — mutating sandpackFiles while
  // iterating imports found across it could make a later stub's own file
  // content get re-scanned; two passes keeps this deterministic.
  const toStub = new Map<string, { needsDefault: boolean; namedExports: Set<string> }>()

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const clause = match[1]
      const resolved = resolveRelativeImport(dir, match[2])
      if (!resolved) continue
      // #1165 follow-up: must check BOTH index.tsx and index.ts — the real
      // AIKit builtin lives at /components/aikit/index.ts (a .ts file, not
      // .tsx). Missing that candidate here made this treat the already-real
      // './components/aikit' import as missing and synthesize a conflicting
      // stub at /components/aikit.tsx, which then won module resolution over
      // the real directory module and rendered MetricCard as undefined —
      // confirmed live on habanero-hub even after the import-injection fix.
      const candidates = [
        resolved,
        `${resolved}.tsx`,
        `${resolved}.ts`,
        `${resolved}/index.tsx`,
        `${resolved}/index.ts`,
      ]
      const exists = candidates.some((c) => c in sandpackFiles)
      if (!exists) {
        const stubPath = `${resolved}.tsx`
        const needs = toStub.get(stubPath) ?? { needsDefault: false, namedExports: new Set<string>() }
        const { needsDefault, named } = parseMissingImportClause(clause)
        needs.needsDefault ||= needsDefault
        for (const n of named) needs.namedExports.add(n)
        toStub.set(stubPath, needs)
      }
    }
  }

  for (const [stubPath, needs] of toStub) {
    if (stubPath in sandpackFiles) continue // a real pass already provided it
    const name = (stubPath.split('/').pop() || 'Missing').replace(/\.tsx$/, '')
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue // not a valid component identifier, skip

    const lines = [
      `import React from 'react'`,
      `// Auto-stubbed: the generation did not produce this file (${stubPath}).`,
    ]
    // Default export, same as before — kept even when nothing observed a
    // default import of this path, so a stub is never a strict regression
    // of #1122's original always-default behavior.
    if (needs.needsDefault || needs.namedExports.size === 0) {
      lines.push(`export default function ${name}() { return null }`)
    }
    // #1122 follow-up: a genuinely missing sibling can just as easily be
    // imported by NAME (`import { Footer } from './components/Footer'`) as
    // by default. A default-only stub leaves that named binding undefined,
    // so rendering it still throws "Element type is invalid" — the exact
    // whole-preview crash this function exists to prevent, just reached via
    // the named-import path instead. Stub every named export actually
    // observed so each one resolves to an inert component too.
    for (const named of needs.namedExports) {
      if (!/^[A-Za-z_$][\w$]*$/.test(named)) continue
      lines.push(`export const ${named} = () => null`)
    }
    sandpackFiles[stubPath] = lines.join('\n') + '\n'
  }
}

/** Parses an import clause into what a missing module stub must provide: a default export, and/or specific named exports (by their EXPORTED name, not any local alias — the stub is matched against the module's real export surface, which aliasing on the import side never changes). */
function parseMissingImportClause(clause: string): { needsDefault: boolean; named: string[] } {
  const trimmed = clause.trim()
  if (!trimmed) return { needsDefault: false, named: [] }

  if (/^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(trimmed)) {
    // `import * as X from '...'` never throws on a missing named export —
    // X is just a (possibly empty) module namespace object. No stub needed.
    return { needsDefault: false, named: [] }
  }

  const braceMatch = trimmed.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}$/)
  if (braceMatch) {
    const named: string[] = []
    for (const raw of braceMatch[2].split(',').map((n) => n.trim()).filter(Boolean)) {
      // Inline type-only specifier (`type Foo`) has no runtime value to stub.
      if (/^type\s+[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(raw)) continue
      const aliasMatch = raw.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      named.push(aliasMatch ? aliasMatch[1] : raw)
    }
    return { needsDefault: Boolean(braceMatch[1]), named }
  }

  const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)$/)
  return { needsDefault: Boolean(defaultMatch), named: [] }
}

/** Resolve a relative import specifier against the importing file's directory. Returns null for anything that isn't a plain relative path this app's own files would use. */
function resolveRelativeImport(fromDir: string, spec: string): string | null {
  const parts = fromDir.split('/').filter(Boolean)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  const resolved = `/${parts.join('/')}`
  return /^\/[\w\-./]+$/.test(resolved) ? resolved : null
}

/**
 * Scans every non-builtin generated file for a top-level named export
 * (`export const/function/class Name`) and returns a name -> logical file
 * path map, for injecting a missing import when another generated file
 * uses that name in JSX without importing it (see #1099 item 4). A name
 * exported from two genuinely different files is dropped entirely rather
 * than guessed — an unresolved ambiguity is strictly safer than a wrong
 * import.
 */
function buildLocalExportMap(sandpackFiles: Record<string, string>, builtinPaths: Set<string>): Map<string, string> {
  const exportRe = /export\s+(?:const|function|class)\s+([A-Z]\w*)/g
  const map = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const normalized = normalizeForRelative(path)
    const names = new Set<string>()
    // #1900: scan a comment/string-masked view — a comment merely MENTIONING
    // an old/removed `export const/function/class Name` declaration (kept
    // "for reference") must never register as a real export here, or the
    // sibling-import injection below wires a file to a component that
    // doesn't actually exist at runtime ("does not provide an export named
    // 'X'" the moment Sandpack evaluates the injected import).
    const masked = maskCommentsAndStrings(code)
    let match: RegExpExecArray | null
    exportRe.lastIndex = 0
    while ((match = exportRe.exec(masked))) names.add(match[1])
    for (const name of extractBareExportListNames(code)) {
      if (/^[A-Z]\w*$/.test(name)) names.add(name)
    }
    for (const name of names) {
      const existing = map.get(name)
      if (existing !== undefined && existing !== normalized) {
        ambiguous.add(name)
        continue
      }
      map.set(name, normalized)
    }
  }
  for (const name of ambiguous) map.delete(name)
  return map
}

/**
 * #2029: companion to buildLocalExportMap() above, for a sibling component
 * that's DEFAULT-exported rather than named — invisible to that function's
 * named-export-only regex, so the sibling-import injector never offered it,
 * leaving real JSX usage of a real, correctly-written component with no
 * import at all (then, after #2026, silently stubbed to an inert no-op by
 * that catch-all instead of crashing outright — see this function's call
 * site for the full incident). Recognizes both default-export shapes an LLM
 * is equally likely to produce:
 *   - inline: `export default function Name() {}` / `export default class
 *     Name {}`
 *   - two-step (confirmed live for company younova's TaskList.tsx):
 *     `function Name() {}` / `const Name = () => {}` ... later, anywhere
 *     else in the file, a bare `export default Name;`
 * A file with an ANONYMOUS default export (`export default function() {}`,
 * `export default () => {}`) has no name to offer here at all — correctly
 * left alone, same as buildLocalExportMap() leaves a name it can't resolve
 * unambiguously. Same ambiguity-drops-the-name safety as that function.
 * Scanned comment/string-masked for the same reason #1900 masks
 * buildLocalExportMap()'s scan: a comment merely MENTIONING an old
 * `export default Name;` line must never register as a real export.
 */
function buildLocalDefaultExportMap(sandpackFiles: Record<string, string>, builtinPaths: Set<string>): Map<string, string> {
  const inlineDefaultRe = /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Z]\w*)/
  const bareDefaultRe = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/
  const localDeclRe = (name: string) =>
    new RegExp(
      `(?:^|[\\n;{(])\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class)\\s+${name}\\b` +
        `|(?:^|[\\n;{(])\\s*(?:export\\s+)?(?:const|let|var)\\s+${name}\\b`,
    )
  const map = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const normalized = normalizeForRelative(path)
    const masked = maskCommentsAndStrings(code)
    let name: string | null = null

    const inlineMatch = masked.match(inlineDefaultRe)
    if (inlineMatch) {
      name = inlineMatch[1]
    } else {
      const bareMatch = masked.match(bareDefaultRe)
      // Only trust a bare `export default Name;` as naming a REAL local
      // component if that exact name also has its own local declaration
      // somewhere in the file — otherwise this is re-exporting some other
      // expression entirely (`export default someVar`, `export default
      // connect(Comp)`, etc.), which this map must not claim to resolve.
      if (bareMatch && /^[A-Z]\w*$/.test(bareMatch[1]) && localDeclRe(bareMatch[1]).test(masked)) {
        name = bareMatch[1]
      }
    }
    if (!name) continue

    const existing = map.get(name)
    if (existing !== undefined && existing !== normalized) {
      ambiguous.add(name)
      continue
    }
    map.set(name, normalized)
  }
  for (const name of ambiguous) map.delete(name)
  return map
}

/**
 * Real gap found live (same "Element type is invalid" bug class #1498
 * already fixed for `export const/function/class Name`): a component
 * declared WITHOUT an inline `export` keyword and exported only via a
 * trailing bare list — `function Footer() { ... }` then, separately,
 * `export { Footer }` — is invisible to the `export\s+(?:const|function|
 * class)\s+Name` regex both `shapeOf()` and `buildLocalExportMap()` rely
 * on, even though the file IS a genuinely valid export. This is not an
 * exotic shape: it's shadcn/ui's own canonical source convention (declare,
 * then `export { Button, buttonVariants }` at the bottom) — exactly the
 * style an LLM asked to produce shadcn-style components is likely to
 * reach for.
 *
 * Missing it means: (1) `fixExportShapeMismatches()` never corrects a
 * wrong bare-default import of such a file (its named set reads as empty,
 * so the bareDefault branch's `shape.named.has(name)` check always
 * fails), and (2) `buildLocalExportMap()` never offers this component for
 * missing-import injection when a sibling uses it in JSX without
 * importing it — both leaving a real, existing, correctly-exported
 * component to resolve as `undefined` at render time.
 *
 * Deliberately excludes re-exports (`export { X } from './Y'`) — this
 * only reads what a file exports of ITS OWN local declarations, same
 * scope as the regex it supplements.
 *
 * #1900: scans a comment/string-masked view (maskCommentsAndStrings(),
 * same technique this file already uses for the react-import check) — a
 * comment merely MENTIONING an old/removed `export { Name }` line (kept
 * "for reference" after a refactor) must never register as a real export,
 * or buildLocalExportMap() below wires a sibling import to a component
 * that doesn't actually exist at runtime.
 */
function extractBareExportListNames(code: string): string[] {
  const names: string[] = []
  const masked = maskCommentsAndStrings(code)
  const re = /export\s*\{([^}]*)\}(?!\s*from)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(masked))) {
    for (const entry of match[1].split(',')) {
      const trimmed = entry.trim()
      if (!trimmed || /^type\s/.test(trimmed)) continue
      const asMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (asMatch) {
        names.push(asMatch[2])
      } else if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        names.push(trimmed)
      }
    }
  }
  return names
}

/**
 * buildSandpackFiles() mirrors every non-entry `/src/X` file to `/X` (see
 * the assembly loop above) so a same-level relative import always resolves
 * regardless of which style a file was generated under. Both copies carry
 * identical content, so stripping the `/src/` prefix collapses them to the
 * same logical path for cross-file export lookups and relative-path math.
 */
function normalizeForRelative(path: string): string {
  return path.replace(/^\/src\//, '/')
}

/** Compute a relative import specifier from one generated file to another, via each file's logical (post-normalizeForRelative) path — independent of which /src-vs-root duplicate either side happens to be. */
function relativeImportPath(fromPath: string, toPath: string): string {
  const fromDir = normalizeForRelative(fromPath).replace(/\/[^/]*$/, '')
  const toNoExt = normalizeForRelative(toPath).replace(/\.(t|j)sx?$/, '')
  const fromParts = fromDir.split('/').filter(Boolean)
  const toParts = toNoExt.split('/').filter(Boolean)
  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++
  const ups = fromParts.length - common
  const rel = [...Array(ups).fill('..'), ...toParts.slice(common)].join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * Detect whether the generated app's own files (excluding builtins) reference
 * lucide-react/recharts/@stripe-js — see sandpack-preview.tsx's #1089/#1097
 * comment for why this conservative substring check is safe (a false positive
 * only costs what unconditional declaration already cost; a false negative
 * never happens because the literal package-name substring can only appear
 * via a real import).
 *
 * usesStripeJs (#1164): the ZeroCommerce checkout instruction
 * (lib/build/primitive-catalog.ts) tells Cody to render Stripe's real
 * Payment Element (loadStripe + Elements + PaymentElement) rather than a
 * hand-rolled card-number form — that import needs `@stripe/stripe-js` and
 * `@stripe/react-stripe-js` declared as Sandpack dependencies the same way
 * lucide-react/recharts already are, or the preview bundle fails to resolve
 * the import.
 *
 * usesA2UI (#126 follow-up): same gap, for the A2UI composition instruction
 * (lib/build/primitive-catalog.ts's A2UI entry) — `@ainative/ai-kit-a2ui`
 * (the renderer) and its `@ainative/ai-kit-a2ui-core` dependency are real
 * published npm packages (first published 2026-10-21) the preview bundle
 * has no reason to already know about.
 */
export function detectSandpackDependencies(sandpackFiles: Record<string, string>): {
  usesLucideReact: boolean
  usesRecharts: boolean
  usesStripeJs: boolean
  usesA2UI: boolean
} {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const generatedCode = Object.entries(sandpackFiles)
    .filter(([path]) => !builtinPaths.has(path))
    .map(([, code]) => code)
    .join('\n')
  return {
    usesLucideReact: generatedCode.includes('lucide-react'),
    usesRecharts: generatedCode.includes('recharts'),
    usesStripeJs: generatedCode.includes('@stripe/'),
    usesA2UI: generatedCode.includes('@ainative/ai-kit-a2ui'),
  }
}
