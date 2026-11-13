/**
 * Flatten a multi-file app into ONE Babel-renderable module (builder#308).
 *
 * The single-file preview (/api/preview/{id}) renders only App.tsx and can't resolve
 * `./components/Header` — so a multi-file app (App imports Header/Hero/…) renders
 * blank on the shareable /build/{slug} page, which always uses that preview. Sandpack
 * fixes this in the live editor, but the share page is server-rendered HTML.
 *
 * This flattener inlines the local component files into App.tsx's scope: strip the
 * relative imports from App, strip each child's own imports/exports, concatenate the
 * children ABOVE App so their `function Header(){…}` become top-level bindings the
 * app's `<Header/>` resolves. External imports (react, recharts, lucide) are already
 * provided as globals by the preview scaffold, so we drop them too. The result is a
 * single module the hardened Babel path renders — no cross-file resolution needed.
 *
 * Conservative: only touches RELATIVE imports (`./` / `../`). If there are no local
 * imports, returns the App code unchanged (single-file apps are unaffected).
 */

const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/** Index of the closing `quote` ending the string starting at `openIdx` (honoring `\`-escapes), or -1 if unterminated. */
function findStringEnd(code: string, openIdx: number, quote: string): number {
  let i = openIdx + 1
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2
      continue
    }
    if (code[i] === quote) return i
    i++
  }
  return -1
}

/** Index of the matching `}` for the `${` interpolation opener at `openIdx` (honoring nested `{}`), or -1 if unbalanced. */
function findMatchingCurly(code: string, openIdx: number): number {
  let depth = 1
  let i = openIdx + 1
  while (i < code.length) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** Index of the closing backtick ending the template literal starting at `openIdx`, honoring nested `${}` interpolations. */
function findBacktickEnd(code: string, openIdx: number): number {
  let i = openIdx + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') return i
    if (ch === '$' && code[i + 1] === '{') {
      const closeIdx = findMatchingCurly(code, i + 1)
      if (closeIdx === -1) return -1
      i = closeIdx + 1
      continue
    }
    i++
  }
  return -1
}

/**
 * Position-preserving mask: every char inside a string/template literal or
 * `//`/`/* *\/` comment becomes a space, with newlines left as real newlines
 * so a line-anchored `^...$/gm` regex still lines up 1:1 against the real
 * code. Unlike a collapsing mask (e.g. jsx-fixer.ts's own
 * maskStringsAndComments, which replaces a whole literal with ONE space),
 * this keeps `code` and the mask the same length, so a regex match's exact
 * span can be compared between the two (see safeReplace below).
 *
 * Real bug this guards against: every regex this file runs below
 * (stripBareNamedExports, nameAnonymousDefaultExport, stripImportsAndExports,
 * hasLocalImports, and the local-import matchAll in flattenMultiFile's
 * inline()) is line-anchored or otherwise scans the RAW, unmasked code — so
 * a generated landing page's own example/demo code block (an ordinary thing
 * for an API/SDK product page: `const snippet = \`\nimport Foo from
 * './foo'\nexport { Foo }\n\`` rendered inside a <pre>/syntax-highlighter)
 * has its import/export-SHAPED demo text matched exactly like a real
 * top-level statement. Confirmed with a direct repro: a two-line demo
 * snippet inside a backtick string gets its `export { Foo }` line silently
 * rewritten by stripBareNamedExports, corrupting the example-code text the
 * founder's own page displays — the same comment/string-blindness class
 * already fixed across obedience-gate.ts / output-validator.ts /
 * jsx-fixer.ts / etc., not yet applied in this file.
 */
function maskStringsAndComments(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    // Single/double-quoted strings are left COMPLETELY UNMASKED (just
    // skipped over, content intact) — unlike a template literal, a `'...'`
    // or `"..."` string can never contain a literal newline in valid JS, so
    // it can never introduce a spurious extra "line" for the line-anchored
    // regexes below to match against. It also means a REAL import/export
    // path string (always single/double-quoted — ES module specifiers can't
    // be template literals) stays exactly as-is, which several of this
    // file's regexes need (`from\s*['"]`, `['"]\.\.?\//`): an earlier
    // version of this mask blanked quoted content unconditionally, which
    // made it indistinguishable from a decoy and broke every real import
    // line too (caught by this file's own test suite before this landed).
    // Only skipped so a quote-char doesn't trip the backtick/comment checks
    // below (e.g. a `//` or backtick appearing inside an ordinary string).
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      const stop = end === -1 ? code.length : end + 1
      out += code.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      if (end === -1) {
        out += ch + code.slice(i + 1).replace(/[^\n]/g, ' ')
        i = code.length
        continue
      }
      out += ch + code.slice(i + 1, end).replace(/[^\n]/g, ' ') + ch
      i = end + 1
      continue
    }
    if (ch === '/' && next === '/') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      out += '//' + code.slice(i + 2, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    }
    if (ch === '/' && next === '*') {
      const closeIdx = code.indexOf('*/', i + 2)
      if (closeIdx === -1) {
        out += '/*' + code.slice(i + 2).replace(/[^\n]/g, ' ')
        i = code.length
        continue
      }
      out += '/*' + code.slice(i + 2, closeIdx).replace(/[^\n]/g, ' ') + '*/'
      i = closeIdx + 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Apply `regex` to `code`, but only actually transform a match whose exact
 * span is byte-identical between `code` and its mask — i.e. contains no
 * string/template-literal/comment content at all. A match that differs
 * under masking is inside (or straddles into) a string/comment and is left
 * untouched, matching this file's existing conservative stance elsewhere
 * (e.g. nameAnonymousDefaultExport's own doc comment).
 */
function safeReplace(code: string, regex: RegExp, replacer: (...args: any[]) => string): string {
  const masked = maskStringsAndComments(code)
  return code.replace(regex, (...args: any[]) => {
    const match = args[0] as string
    const offset = args[args.length - 2] as number
    const maskedSlice = masked.slice(offset, offset + match.length)
    if (maskedSlice !== match) return match
    return replacer(...args)
  })
}

/**
 * Strip a wrapping markdown code fence (```jsx ... ``` / ```tsx ... ``` / bare
 * ``` ... ```), if present, before FILE-marker parsing (builder#499).
 *
 * `storePreview()` (app/api/chat-ws/route.ts) wraps the served code as
 * `` `\`\`\`jsx\n${finalContent}\n\`\`\`` `` before writing it to the in-memory
 * preview store, and `resolveStoredApp()` (lib/build/ready-gate.ts) reads that
 * store FIRST — so `raw` here is routinely the FENCED string, not the bare
 * FILE-marker blob. parseFiles() has no concept of code fences: it only splits
 * on `// --- FILE: ---` lines, so the closing ` ``` ` line was silently
 * appended as a trailing line of whichever file happened to be LAST in the
 * blob. That stray triple-backtick then parses as an unterminated template
 * literal once flattened — reproduced exactly in
 * __tests__/lib/build/flatten-multifile.test.ts ("fenced multi-file input").
 * This is the confirmed root cause of the register-app 422 syntax_error
 * false-positives on genuinely valid, successfully-generated apps.
 *
 * Conservative: only strips a fence that wraps the ENTIRE string (opening
 * fence on the first non-blank line, closing fence on the last non-blank
 * line) — a stray ``` appearing mid-file (e.g. inside a JSX text node) is left
 * untouched.
 */
function stripWrappingCodeFence(raw: string): string {
  const trimmed = (raw || '').trim()
  const m = trimmed.match(/^```[a-zA-Z0-9]*\s*\n([\s\S]*?)\n?```$/)
  return m ? m[1] : raw
}

/**
 * Line indices (0-based) of `code` that sit INSIDE a still-open backtick
 * template literal or block comment (`/* ... *\/`) carried over from an
 * earlier line, rather than at top level. A single/double-quoted string or
 * a `//` line comment can never contain a literal newline in valid JS, so
 * they can't hide an embedded line this way — only these two multi-line
 * constructs can.
 *
 * Real bug this guards against: parseFiles() below is the one scan in this
 * file that was never routed through this file's existing masking helpers
 * — it matches `FILE_MARKER` against every RAW line of the blob. A
 * generated file demonstrating or documenting this exact `// --- FILE:
 * ... ---` convention inside its own multi-line `/* *\/` comment or a
 * backtick demo-code string (an ordinary thing on a docs/API-product page)
 * has that line split off as a bogus extra "file", corrupting the real
 * file it actually belongs to and potentially clobbering whatever file
 * follows under the same (reused) marker name.
 */
function linesInsideMultilineConstruct(code: string): Set<number> {
  const inside = new Set<number>()
  const markSpan = (from: number, to: number, line: number): number => {
    for (let j = from; j < to; j++) if (code[j] === '\n') { line++; inside.add(line) }
    return line
  }
  let line = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      i = end === -1 ? code.length : end + 1
      continue
    }
    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i)
      i = end === -1 ? code.length : end
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      const stop = end === -1 ? code.length : end + 1
      line = markSpan(i, stop, line)
      i = stop
      continue
    }
    if (ch === '/' && next === '*') {
      const closeIdx = code.indexOf('*/', i + 2)
      const stop = closeIdx === -1 ? code.length : closeIdx + 2
      line = markSpan(i, stop, line)
      i = stop
      continue
    }
    if (ch === '\n') { line++; i++; continue }
    i++
  }
  return inside
}

/** Parse `// --- FILE: path ---` markers into { normalizedBasename: code }. */
export function parseFiles(raw: string): Record<string, string> {
  const files: Record<string, string> = {}
  let cur: string | null = null
  let buf: string[] = []
  const stripped = stripWrappingCodeFence(raw)
  const hiddenLines = linesInsideMultilineConstruct(stripped)
  const lines = stripped.split('\n')
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const m = hiddenLines.has(idx) ? null : line.match(FILE_MARKER)
    if (m) {
      if (cur) files[cur] = buf.join('\n').trim()
      cur = m[1].trim()
      buf = []
    } else buf.push(line)
  }
  if (cur) files[cur] = buf.join('\n').trim()
  return files
}

/** basename without extension, e.g. src/components/Header.tsx → Header */
function baseName(path: string): string {
  return path.replace(/\.[jt]sx?$/, '').split('/').pop() || path
}

/**
 * Package names whose imported bindings are ACTUALLY pre-bound as bare
 * globals by the preview scaffold before this flattened code runs (confirmed
 * via app/api/preview/[id]/route.ts: React/hooks are assigned onto `window`
 * directly; `lucide-react` icon names are bound via a `_getIcon` walk; the
 * fixed `recharts` chart-component names are destructured from
 * `window.Recharts`). Stripping an import from one of these is genuinely
 * safe — the names it would have bound already exist by the time this code
 * executes.
 */
const GLOBALLY_PROVIDED_PACKAGES = new Set(['react', 'react-dom', 'lucide-react', 'recharts'])

/**
 * Give an anonymous default export a real name before stripImportsAndExports'
 * own export-stripping regexes run on it.
 *
 * Real bug (found this run via static analysis + a direct @babel/core repro,
 * not yet filed): `export default function(){...}`, `export default
 * class {...}`, and `export default () => {...}` (or any other inline
 * default-export expression) are all common, ordinary ways a generated
 * sibling component names itself — just as common as the already-handled
 * `export default function Foo(){...}` / `export default Foo;` shapes. None
 * of them survive this file's existing export-stripping regexes intact:
 * - `export default function(){}` only matches the "export default
 *   function" → "function" regex below, which doesn't check for a name —
 *   it produces a bare `function(){}` STATEMENT, which is itself a
 *   SyntaxError (function declarations require a name).
 * - `export default class {}` is the same shape, same failure
 *   (`class {}` statement — "A class name is required").
 * - `export default () => {...}` (or any non-identifier expression) matches
 *   NONE of the regexes below (they only strip a bare trailing identifier
 *   reference), so the literal `export` keyword survives into the flattened
 *   single-file output.
 *
 * That flattened output is injected into a plain, non-module `<script>` tag
 * by app/api/preview/[id]/route.ts (the single-file preview powering
 * /build/{slug} share pages for single-file apps) — no import/export syntax
 * is valid there at all. Confirmed directly against this file's real
 * @babel/core dependency: ALL THREE shapes throw at the Babel-transform step
 * itself (either "Unexpected token" for the two malformed statements, or "A
 * class name is required"), which route.ts's own try/catch turns into
 * `window.__BABEL_FAILED__ = true` — the component-detection step is then
 * skipped entirely, so the preview silently stays blank. Exactly the
 * "blank page" crash class this repo's rendering-correctness effort exists
 * to catch, just reached through this flattener instead of build-files.ts.
 *
 * `fallbackName` lets a caller that knows the importer's own local binding
 * name (inline(), below, for a sibling file) give the synthetic declaration
 * THAT name, so `<Footer/>` keeps resolving to the real component instead of
 * falling back to route.ts's separate generic undefined-tag placeholder.
 * Conservative like the rest of this file: a default-export expression that
 * ISN'T the file's trailing statement (something follows it) is left
 * untouched rather than guessing where it ends.
 */
function nameAnonymousDefaultExport(code: string, fallbackName: string): string {
  const namedFunction = safeReplace(
    code,
    /(^|\n)(\s*)export\s+default\s+function(\s*)\(/,
    (_m, pre: string, indent: string) => `${pre}${indent}export default function ${fallbackName}(`,
  )
  if (namedFunction !== code) return namedFunction

  const namedClass = safeReplace(
    code,
    /(^|\n)(\s*)export\s+default\s+class(\s*)(\{|extends\b)/,
    (_m, pre: string, indent: string, _sp: string, after: string) =>
      `${pre}${indent}export default class ${fallbackName} ${after}`,
  )
  if (namedClass !== code) return namedClass

  const masked = maskStringsAndComments(code)
  const trailingMatch = code.match(/(^|\n)(\s*)export\s+default\s+([\s\S]+?);?\s*$/)
  if (
    trailingMatch &&
    trailingMatch.index !== undefined &&
    masked.slice(trailingMatch.index, trailingMatch.index + trailingMatch[0].length) === trailingMatch[0] &&
    !/^[A-Za-z_$][\w$]*$/.test(trailingMatch[3].trim())
  ) {
    const prefix = code.slice(0, trailingMatch.index)
    const [, pre, indent, expr] = trailingMatch
    // #1994: a truncated `export default ` with nothing but a trailing `;`
    // (or only whitespace) after it still satisfies the `[\s\S]+?` capture —
    // it only requires ONE character, and the file's own per-file `.trim()`
    // (parseFiles) always eats pure trailing whitespace, but NOT a trailing
    // `;` — so `expr` comes back as just `";"` (or whitespace) with no real
    // expression in it. Emitting `const ${fallbackName} = ${expr};` then
    // produces `const AIKitHeader = ;;` — the parser throws "Unexpected
    // token" at the FIRST `;` (the lone `;` right after `=`), reading
    // identically to `const AIKitHeader = ;` in the error detail, which is
    // exactly what two independent real companies ("tidemark"/"driftwood")
    // hard-failed their /build/{slug} preview with. A safe no-op stub
    // component keeps the blob syntactically valid — this one child renders
    // nothing instead of the whole page staying blank.
    const exprCore = expr.replace(/;+\s*$/, '').trim()
    if (exprCore === '') {
      return `${prefix}${pre}${indent}function ${fallbackName}() { return null; }`
    }
    return `${prefix}${pre}${indent}const ${fallbackName} = ${expr};\nexport default ${fallbackName};`
  }

  return code
}

/**
 * Real bug found live (Dispatch, 2026-09-11): stripImportsAndExports used to
 * strip EVERY import line unconditionally, including named imports from
 * arbitrary external packages (e.g. `import { Card, Button, Dialog, Input }
 * from '@radix-ui/react-dialog'` — a real generation's hallucinated import,
 * naming shadcn/ui-style components @radix-ui/react-dialog doesn't actually
 * export). The doc comment's claim that "external imports are already
 * provided as globals" is only true for GLOBALLY_PROVIDED_PACKAGES above —
 * everything else has NOTHING backing those names. The flattened code then
 * referenced Card/Button/Dialog/etc. as bare, wholly undeclared identifiers,
 * threw at render, and the ErrorBoundary swallowed it into the degraded
 * "Refining your app" state — the real UI never painted, matching the
 * customer-reported "basic UI components are missing."
 *
 * Fixed the same way #308 already handles a DANGLING local import (a
 * generator-side mistake this flattener can't correct, but CAN degrade
 * gracefully from): any named import from a package NOT in
 * GLOBALLY_PROVIDED_PACKAGES gets each of its named bindings replaced with a
 * harmless stub (a no-op component for PascalCase names, `undefined` for
 * anything else) instead of silently vanishing — better a missing/blank
 * section than the whole app throwing before anything renders.
 */
/**
 * Strip a bare, local `export { Name }` / `export { Name, Other }` list
 * (NOT a default export — those are handled separately above/below) —
 * same bug class as #1498/#1499 (build-files.ts), #1506/#1507 + #1519/#1520
 * (multi-file-parser.ts) and #1515/#1516 + #1587/#1588 (sandbox-builder.ts):
 * a generated sibling component commonly names itself via `function Foo(){}`
 * + a trailing `export { Foo }`, just as often as a `export default`. None
 * of stripImportsAndExports' other regexes match this shape (they only
 * touch `export default ...` and `export (const|let|function|class) ...`
 * declaration exports), so the literal `export { Foo }` line survived
 * flattening verbatim — invalid syntax in the plain, non-module `<script>`
 * tag app/api/preview/[id]/route.ts injects this flattened output into,
 * throwing at the Babel-transform step and blanking the whole preview.
 *
 * The underlying declaration (`function Foo(){}`) is already correctly
 * inlined above this line, so the fix only needs to drop the export
 * wrapper — not rename anything. The one exception is a renaming alias
 * (`export { Foo as Bar }`): since callers only ever reference the
 * declared name (`Foo`) in JSX, not the alias, a `const Bar = Foo;` binding
 * is emitted so either spelling resolves. `as default` is a no-op alias
 * (the declared name already IS what the importer treats as the default)
 * and is dropped silently, matching this file's existing behavior for a
 * plain `export default Foo;` (also never renames).
 */
function stripBareNamedExports(code: string): string {
  return safeReplace(code, /^\s*export\s*\{([^}]*)\}\s*;?\s*$/gm, (_m, namesClause: string) => {
    const aliases = namesClause
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const [local, alias] = n.split(/\s+as\s+/).map((p) => p.trim())
        return alias && alias !== 'default' && alias !== local ? `const ${alias} = ${local};` : ''
      })
      .filter(Boolean)
    return aliases.join('\n')
  })
}

function stripImportsAndExports(code: string, fallbackName = 'DefaultComponent'): string {
  const stubs: string[] = []
  const stubbed = new Set<string>()

  const named = nameAnonymousDefaultExport(stripBareNamedExports(code), fallbackName)

  // #1529: this only matched an import with a `{...}` named clause — a BARE
  // default-only import from a non-backed external package (`import Modal
  // from 'some-ui-lib'`, no named clause at all) never matched, so it fell
  // through untouched into the generic unconditional import-strip below,
  // which removes the line with NO stub generated. Any JSX reference to that
  // import (`<Modal/>`) became a bare, wholly undeclared identifier in the
  // flattened output — a ReferenceError at render, the same outcome the
  // named-import case (Dispatch, 2026-09-11, see the doc comment above) was
  // already fixed for. The named clause is now optional, covering all three
  // shapes a generated sibling actually uses: bare default-only, bare
  // named-only, and the combined default+named clause.
  const withStubbedExternals = safeReplace(
    named,
    /^\s*import\s+(?:(\w+)(?:\s*,\s*\{([^}]*)\})?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"];?\s*$/gm,
    (full, defaultName: string | undefined, namedWithDefault: string | undefined, namedOnly: string | undefined, pkg: string) => {
      if (GLOBALLY_PROVIDED_PACKAGES.has(pkg) || pkg.startsWith('./') || pkg.startsWith('../')) return full
      const namedClause = namedWithDefault ?? namedOnly ?? ''
      const names = [
        ...(defaultName ? [defaultName] : []),
        ...namedClause.split(',').map((n) => n.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
      ]
      for (const name of names) {
        if (stubbed.has(name)) continue
        stubbed.add(name)
        stubs.push(
          /^[A-Z]/.test(name)
            ? `function ${name}(props){ return (props && props.children) || null; } // stub: '${pkg}' import not backed by the preview scaffold`
            : `const ${name} = undefined; // stub: '${pkg}' import not backed by the preview scaffold`,
        )
      }
      return ''
    },
  )

  // whole import lines (single and multi-line handled by the `from '...'` anchor)
  // — local/relative and now-stubbed-external ones are already gone above;
  // this still needs to remove the GLOBALLY_PROVIDED_PACKAGES imports and
  // any bare default-only import this session's regex above didn't match.
  // Each step below is a safeReplace (not a plain .replace chain) because
  // every regex is line-anchored and re-run against the PRIOR step's output
  // each time — so a demo code snippet's own import/export-shaped text, still
  // present at this point, needs re-masking at every step, not just once.
  let stripped = safeReplace(withStubbedExternals, /^\s*import\s+[^\n]*?from\s*['"][^'"]+['"];?\s*$/gm, () => '')
  stripped = safeReplace(stripped, /^\s*import\s+['"][^'"]+['"];?\s*$/gm, () => '')
  // `export default function X` → `function X` ; `export default X` dropped later
  stripped = safeReplace(stripped, /^\s*export\s+default\s+function/gm, () => 'function')
  stripped = safeReplace(stripped, /^\s*export\s+default\s+class/gm, () => 'class')
  stripped = safeReplace(stripped, /^\s*export\s+(const|let|function|class)/gm, (_m, kw: string) => kw)
  // a trailing `export default Foo;` line (component already defined above)
  stripped = safeReplace(stripped, /^\s*export\s+default\s+\w+\s*;?\s*$/gm, () => '')
  stripped = stripped.trim()

  return stubs.length ? [...stubs, stripped].join('\n') : stripped
}

/** Does the App code import any LOCAL (relative) modules? */
export function hasLocalImports(appCode: string): boolean {
  // Tested against the masked copy, not the raw code — same comment/string-
  // blindness fix as the rest of this file: a demo code block merely
  // mentioning a relative import shouldn't make this true.
  return /^\s*import\s+[^\n]*?from\s*['"]\.\.?\//m.test(maskStringsAndComments(appCode || ''))
}

/**
 * Flatten a multi-file marker string into a single module. If it's not multi-file
 * (no markers) or the App has no local imports, returns the extracted app code as-is.
 */
export function flattenMultiFile(raw: string): string {
  const files = parseFiles(raw)
  const paths = Object.keys(files)
  if (paths.length <= 1) {
    // Not multi-file — return unchanged. The preview route's existing extraction +
    // render already handles a single file (incl. its `export default`); flattening
    // is ADDITIVE, only for the multi-file case, so single-file stays a no-op.
    return paths.length === 1 ? files[paths[0]] : raw
  }

  // Find the entry (App.tsx / the file that imports the others).
  const appPath =
    paths.find((p) => /(^|\/)App\.[jt]sx?$/.test(p)) ||
    paths.find((p) => hasLocalImports(files[p])) ||
    paths[0]
  const appCode = files[appPath]

  if (!hasLocalImports(appCode)) {
    // App doesn't import siblings — single-file render is fine. 'App' as the
    // fallback name (an anonymous default export only) also matches
    // app/api/preview/[id]/route.ts's own page-component-detection name list.
    return stripImportsAndExports(appCode, 'App')
  }

  // Map local module basenames → their file code, so we inline in dependency order.
  const byBase: Record<string, string> = {}
  for (const p of paths) if (p !== appPath) byBase[baseName(p)] = files[p]

  // Which local names does App import? Inline those (and any they transitively need).
  const inlined: string[] = []
  const seen = new Set<string>()
  const stubbed: string[] = []
  const inline = (code: string) => {
    // #1517: the old regex only matched a BARE default import (`import Hero
    // from './Hero'`) or a BARE named-only import (`import { HeroProps }
    // from './Hero'`) — never a combined clause on one line (`import Hero,
    // { HeroProps } from './Hero'`), an ordinary shape when a sibling
    // component also exports a TS prop-type alongside its default export.
    // The combined form matched neither alternative, so the import was never
    // detected here at all: never inlined (the byBase lookup never
    // attempted) and never stubbed by the dangling-import fallback either
    // (that only fires when the regex matched but no child file exists).
    // stripImportsAndExports()'s own unconditional import-stripping regex
    // still removed the import LINE from App's code regardless, leaving
    // `<Hero/>` referencing a wholly undeclared identifier — a
    // ReferenceError at render in the single-file preview's non-module
    // <script> tag. The named clause is now absorbed (but not captured) as
    // an optional trailing group on the default-name alternative, so a bare
    // default-only or bare named-only import still matches exactly as
    // before — only the previously-unmatched combined clause is new.
    // Not line-anchored like the rest of this file's regexes, so a decoy
    // mention needs its own masked-span check rather than safeReplace's
    // (which assumes a .replace callback): skip any match whose span was
    // altered by masking — i.e. one that lives inside a string/template
    // literal/comment, such as a demo code block's own `import Foo from
    // './foo'` example line.
    const maskedCode = maskStringsAndComments(code)
    for (const m of code.matchAll(/import\s+(?:(\w+)(?:\s*,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s*['"]\.\.?\/([^'"]+)['"]/g)) {
      if (m.index === undefined) continue
      if (maskedCode.slice(m.index, m.index + m[0].length) !== m[0]) continue
      const base = baseName(m[2])
      const child = byBase[base]
      const defaultName = m[1]
      if (child && !seen.has(base)) {
        seen.add(base)
        inline(child) // transitive deps first
        // Prefer the importer's own local binding name (defaultName) as the
        // fallback for an anonymous default export, so <Footer/> still
        // resolves to the real component after naming it — falling back to
        // the file's basename only for a named-import clause, where there's
        // no single importer-local name to prefer.
        inlined.push(`// inlined from ${base}\n${stripImportsAndExports(child, defaultName || base)}`)
      } else if (!child && defaultName && !seen.has(defaultName)) {
        // DANGLING import (builder#308): App imports a component the model never
        // emitted a file for (e.g. aerosol imported Cart/Footer with no Cart.tsx).
        // Rendering it undefined throws and blanks the app — emit a harmless stub
        // so the rest of the app renders. Better a missing section than a blank app.
        seen.add(defaultName)
        stubbed.push(`function ${defaultName}(props){ return null; } // stub: ${base} not emitted by generator`)
      }
    }
  }
  inline(appCode)

  const appBody = stripImportsAndExports(appCode, 'App')
  return [...stubbed, ...inlined, appBody].join('\n\n')
}
