/**
 * Output validation for Cody-generated app code (#366).
 *
 * `lib/professional-prompt.ts` and `lib/build/coding-standards.ts`'s C5
 * security-baseline rule TELL the model what to do. Nothing previously
 * re-read the generated output afterward to check it actually did it. This
 * module is that check: a fast, deterministic, string/regex-based pass over
 * the generated code — no LLM call, no browser, never a fabricated pass.
 *
 * Mirrors `coverage-runner.ts`'s honesty principle (never invent a result)
 * and reuses `coding-standards.ts`'s `StandardsCheck`/`StandardsResult` shape
 * so callers already familiar with that shape don't need a second mental
 * model.
 *
 * Scope (per #366): validates single-shot generated APP code (the
 * chat-ws/professional-prompt.ts path) — not the swarm/agentic path, which
 * has its own real coverage-gated verification (coverage-runner.ts, #372).
 *
 * #384 added a 4th rule (findMissingJsxImports/validateFileImports): a
 * generated file using a JSX component with no import binding or local
 * definition — a guaranteed ReferenceError at render, distinct from and
 * unguarded by both this module's original 3 rules and
 * completeness-gate.ts's findMissingLocalImports (which checks the OPPOSITE
 * direction: that every import STATEMENT resolves, not that every JSX USE is
 * imported). It runs on the full multi-file payload rather than a single code
 * string, so it is a separate exported function rather than a 4th entry in
 * validateOutput()'s single-string aggregate.
 */

import type { StandardsCheck, StandardsResult } from './coding-standards'

// ---------------------------------------------------------------------------
// Rule 1: dangerouslySetInnerHTML on non-static content
// ---------------------------------------------------------------------------

/**
 * Matches `dangerouslySetInnerHTML={{ __html: <arg> }}` and captures <arg>.
 * Handles the common single-line JSX form; a generated app's own multi-line
 * variants still match since JS expressions inside `__html:` rarely span a
 * hard newline before the closing `}}` in generated code.
 */
const DANGEROUS_HTML_PATTERN = /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html:\s*([^}]+?)\s*\}\}/g

/**
 * A literal/static argument is safe: a plain string literal, or a call to
 * JSON.stringify(...) on an inline object literal (the JSON-LD pattern the AX
 * rubric itself prescribes, AX-8). Anything referencing a variable, prop,
 * state, or fetch result is flagged.
 */
function isStaticHtmlArg(arg: string): boolean {
  const trimmed = arg.trim()
  // Plain string/template literal with no interpolation.
  if (/^(['"])(?:(?!\1).)*\1$/.test(trimmed)) return true
  if (/^`(?:[^`$]|\$(?!\{))*`$/.test(trimmed)) return true
  // JSON.stringify(<object literal>) — the JSON-LD structured-data pattern.
  if (/^JSON\.stringify\(\s*\{/.test(trimmed)) return true
  return false
}

/** PURE. Returns every dangerouslySetInnerHTML call whose argument isn't static. */
export function findUnsafeDangerousHtml(code: string): string[] {
  const matches: string[] = []
  let m: RegExpExecArray | null
  DANGEROUS_HTML_PATTERN.lastIndex = 0
  while ((m = DANGEROUS_HTML_PATTERN.exec(code)) !== null) {
    const arg = m[1]
    if (!isStaticHtmlArg(arg)) {
      matches.push(arg.trim().slice(0, 80))
    }
  }
  return matches
}

// ---------------------------------------------------------------------------
// Rule 2: console.log/warn referencing secret-shaped values
// ---------------------------------------------------------------------------

const CONSOLE_CALL_PATTERN = /console\.(?:log|warn)\s*\(([^)]*)\)/g
const SECRET_ARG_PATTERN = /apiKey|api_key|token|secret|password|process\.env\.\w*_KEY/i

/** PURE. Returns every console.log/warn call whose arguments look secret-shaped. */
export function findSecretLoggingCalls(code: string): string[] {
  const matches: string[] = []
  let m: RegExpExecArray | null
  CONSOLE_CALL_PATTERN.lastIndex = 0
  while ((m = CONSOLE_CALL_PATTERN.exec(code)) !== null) {
    const args = m[1]
    if (SECRET_ARG_PATTERN.test(args)) {
      matches.push(args.trim().slice(0, 80))
    }
  }
  return matches
}

// ---------------------------------------------------------------------------
// Rule 3: exactly one <h1> (AX rubric AX-5, professional-prompt.ts's own
// "CRITICAL RULE: EXACTLY ONE <h1> PER PAGE")
// ---------------------------------------------------------------------------

const H1_OPEN_TAG_PATTERN = /<h1[\s>]/gi

/** PURE. Counts top-level <h1> opening tags in the generated code. */
export function countH1Tags(code: string): number {
  const matches = code.match(H1_OPEN_TAG_PATTERN)
  return matches ? matches.length : 0
}

// ---------------------------------------------------------------------------
// Aggregate check — mirrors coding-standards.ts's StandardsCheck/StandardsResult
// ---------------------------------------------------------------------------

export function checkNoUnsafeDangerousHtml(code: string): StandardsCheck {
  const unsafe = findUnsafeDangerousHtml(code)
  if (unsafe.length === 0) {
    return { name: 'no-unsafe-dangerous-html', passed: true }
  }
  return {
    name: 'no-unsafe-dangerous-html',
    passed: false,
    reason: `${unsafe.length} dangerouslySetInnerHTML call(s) with non-static content`,
    details: unsafe.map((a) => `__html: ${a}`),
  }
}

export function checkNoSecretLogging(code: string): StandardsCheck {
  const hits = findSecretLoggingCalls(code)
  if (hits.length === 0) {
    return { name: 'no-secret-logging', passed: true }
  }
  return {
    name: 'no-secret-logging',
    passed: false,
    reason: `${hits.length} console.log/warn call(s) reference secret-shaped values`,
    details: hits.map((a) => `console.log(${a})`),
  }
}

export function checkSingleH1(code: string): StandardsCheck {
  const count = countH1Tags(code)
  if (count === 1) {
    return { name: 'single-h1', passed: true, details: ['Exactly one <h1> found'] }
  }
  return {
    name: 'single-h1',
    passed: false,
    reason: count === 0 ? 'No <h1> found on the page' : `${count} <h1> tags found — AX rubric requires exactly one`,
    details: [`Found: ${count}`],
  }
}

/**
 * Run every output-validation rule over a generated code string. PURE — no
 * I/O, no LLM call, never fabricates a result. Mirrors checkAllStandards's
 * aggregation shape from coding-standards.ts.
 */
export function validateOutput(code: string): StandardsResult {
  const checks: StandardsCheck[] = [
    checkNoUnsafeDangerousHtml(code),
    checkNoSecretLogging(code),
    checkSingleH1(code),
  ]

  const passed = checks.every((c) => c.passed)
  const failedChecks = checks.filter((c) => !c.passed)
  const summary = passed
    ? `All ${checks.length} output-validation checks passed`
    : `${failedChecks.length}/${checks.length} output-validation checks failed: ${failedChecks.map((c) => c.name).join(', ')}`

  return { passed, checks, summary }
}

// ---------------------------------------------------------------------------
// Rule 4 (#384): JSX uses a component with no corresponding import binding
// or local definition in the SAME file.
//
// Repro (real, jason@adamandella.com's "Driftwood" generation, chatId
// 0QxLlJ7sNhKLynRhqrDCN): /src/App.tsx used <Card>, <Button>, <Select>, etc.
// in JSX but never imported them — even though card.tsx/button.tsx/select.tsx
// all existed as real files elsewhere in the SAME payload. Guaranteed
// `ReferenceError: Card is not defined` at render.
//
// Distinct from lib/build/completeness-gate.ts's findMissingLocalImports,
// which checks the OPPOSITE direction: does every IMPORT STATEMENT resolve to
// a real file in the payload (catches truncation). That gate also treats
// components/ui/* and components/aikit/* as always-satisfiable (the preview
// runtime injects them), so it has no way to notice a *consuming* file simply
// forgot to import them — exactly this bug. This rule instead asks: for every
// capitalized JSX tag actually USED in a file, is there an import binding (or
// a local definition) for it IN THAT SAME FILE? Deliberately per-file, no
// cross-file resolution — cross-file resolution is completeness-gate's job.
// ---------------------------------------------------------------------------

/** Extract local binding names introduced by every import statement in `code`.
 *  Handles the same forms as completeness-gate.ts's parseClauseBindings:
 *    import X from '…'            → [X]
 *    import { A, B as C } from '…' → [A, C]
 *    import X, { A } from '…'     → [X, A]
 *    import * as NS from '…'      → [NS]
 *  Import clauses may span multiple lines (named imports wrapped for length),
 *  so this matches across newlines rather than assuming a single source line.
 */
function parseImportBindings(code: string): Set<string> {
  const bindings = new Set<string>()
  const withClause = /import\s+([^'";]+?)\s+from\s*['"][^'"]+['"]/g
  let m: RegExpExecArray | null
  while ((m = withClause.exec(code)) !== null) {
    const clause = m[1].trim()
    if (/^type\s/.test(clause)) continue // import type — erased at runtime, not a value binding
    const ns = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/)
    if (ns) bindings.add(ns[1])
    const named = clause.match(/\{([^}]*)\}/)
    if (named) {
      for (const raw of named[1].split(',')) {
        const s = raw.trim()
        if (!s || /^type\s/.test(s)) continue
        const local = s.split(/\s+as\s+/).pop()!.trim()
        if (/^[A-Za-z_$][\w$]*$/.test(local)) bindings.add(local)
      }
    }
    // Default import: the identifier before any `{` or `*`.
    const head = clause.split(/[{*]/)[0].replace(/,\s*$/, '').trim()
    if (head && /^[A-Za-z_$][\w$]*$/.test(head)) bindings.add(head)
  }
  return bindings
}

/** Local component/value definitions in `code`: function/class/const/let/var. */
function parseLocalDefinitions(code: string): Set<string> {
  const defs = new Set<string>()
  const re = /(?:^|[\n;{(\s])(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g
  const re2 = /(?:^|[\n;{(\s])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) defs.add(m[1])
  while ((m = re2.exec(code)) !== null) defs.add(m[1])
  return defs
}

/** Identifiers that are always in scope in generated app code without an
 *  explicit import — the classic JSX runtime pragma and React namespace
 *  members accessed as `<React.Fragment>` (the base `React` still needs a
 *  binding check; only the well-known members are exempted outright). */
const AMBIENT_JSX_GLOBALS = new Set(['Fragment'])

/**
 * PURE. Returns the capitalized JSX component names USED in `code` that have
 * no import binding and no local definition in the SAME file. Namespaced JSX
 * (`<Foo.Bar>`) checks only the base identifier `Foo` — `Bar` is a property
 * access, not a separate binding. Lowercase tags (real DOM elements) are
 * never flagged, matching JSX's own capitalization convention for components.
 */
export function findMissingJsxImports(code: string): string[] {
  const used = new Set<string>()
  const jsxTag = /<([A-Z][\w$]*)(?:\.[A-Za-z_$][\w$]*)?[\s/>]/g
  let m: RegExpExecArray | null
  while ((m = jsxTag.exec(code)) !== null) {
    used.add(m[1])
  }
  if (used.size === 0) return []

  const bindings = parseImportBindings(code)
  const defs = parseLocalDefinitions(code)

  const missing: string[] = []
  for (const name of used) {
    if (AMBIENT_JSX_GLOBALS.has(name)) continue
    if (bindings.has(name) || defs.has(name)) continue
    missing.push(name)
  }
  return missing.sort()
}

export function checkJsxImportsResolved(code: string): StandardsCheck {
  const missing = findMissingJsxImports(code)
  if (missing.length === 0) {
    return { name: 'jsx-imports-resolved', passed: true }
  }
  return {
    name: 'jsx-imports-resolved',
    passed: false,
    reason: `${missing.length} JSX component(s) used with no import or local definition: ${missing.join(', ')}`,
    details: missing,
  }
}

/**
 * Run checkJsxImportsResolved over every source file in a generated payload.
 * PURE, deterministic, per-file — a component missing from one file's imports
 * is never satisfied by another file importing it (that's a different bug,
 * completeness-gate.ts's job). Mirrors StandardsResult's aggregation shape;
 * `checks` has one entry per checked file so a caller can see exactly which
 * file(s) are broken, not just that "something" is.
 */
export function validateFileImports(files: Record<string, string>): StandardsResult {
  const codeFile = /\.(t|j)sx?$/
  const checks: StandardsCheck[] = []

  for (const [path, content] of Object.entries(files)) {
    if (!codeFile.test(path) || path.endsWith('.d.ts') || typeof content !== 'string') continue
    const missing = findMissingJsxImports(content)
    if (missing.length === 0) {
      checks.push({ name: path, passed: true })
    } else {
      checks.push({
        name: path,
        passed: false,
        reason: `${missing.length} JSX component(s) used with no import or local definition: ${missing.join(', ')}`,
        details: missing,
      })
    }
  }

  const passed = checks.every((c) => c.passed)
  const failedChecks = checks.filter((c) => !c.passed)
  const summary = passed
    ? `All ${checks.length} file(s) resolve their JSX component imports`
    : `${failedChecks.length}/${checks.length} file(s) use JSX components with no import: ${failedChecks.map((c) => c.name).join(', ')}`

  return { passed, checks, summary }
}
