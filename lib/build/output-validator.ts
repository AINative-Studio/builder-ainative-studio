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
