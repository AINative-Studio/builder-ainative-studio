/**
 * Gradient Blocker Utility
 * Removes Tailwind gradient classes from generated code
 */

import { findStringEnd, findBacktickEnd, findMatchingBrace } from './build/bracket-scanner'

/**
 * Tailwind gradient patterns to block
 */
const GRADIENT_PATTERNS = [
  /bg-gradient-\w+/g, // bg-gradient-to-r, bg-gradient-to-br, etc.
  /from-\w+-\d+/g, // from-blue-500, from-purple-600, etc.
  /via-\w+-\d+/g, // via-pink-500, etc.
  /to-\w+-\d+/g, // to-red-500, to-yellow-400, etc.
]

/**
 * Visits every string/template-literal content span in `code[start, end)`,
 * treating `//` and `/* ... *‍/` comments as opaque so a bracket-shaped or
 * gradient-shaped character inside one is never mistaken for literal
 * content. Each visit gets the span's content bounds (excluding the
 * quotes/backticks themselves).
 */
function forEachLiteralContent(
  code: string,
  start: number,
  end: number,
  visit: (contentStart: number, contentEnd: number) => void,
): void {
  let i = start
  while (i < end) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i)
      i = nl === -1 || nl > end ? end : nl + 1
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      const close = code.indexOf('*/', i + 2)
      i = close === -1 || close > end ? end : close + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      const closeIdx = findStringEnd(code, i, ch)
      if (closeIdx === -1 || closeIdx > end) {
        i++
        continue
      }
      visit(i + 1, closeIdx)
      i = closeIdx + 1
      continue
    }
    if (ch === '`') {
      const closeIdx = findBacktickEnd(code, i)
      if (closeIdx === -1 || closeIdx > end) {
        i++
        continue
      }
      visit(i + 1, closeIdx)
      i = closeIdx + 1
      continue
    }
    i++
  }
}

/**
 * Finds every `className=...` attribute's actual class-list text in `code`
 * and returns each as a [start, end) span into `code` — covering
 * `className="..."`, `className='...'`, and every string/template literal
 * living inside a `className={...}` expression (a plain template literal,
 * `cn()`/`clsx()` call arguments, a ternary's branches, etc).
 *
 * Real bug this exists to fix: `stripGradients()` used to run its
 * gradient-class regexes against the ENTIRE file with no scoping at all, so
 * a `from-\w+-\d+`/`to-\w+-\d+`-shaped substring anywhere else in a
 * generated file — a real `href`, a button/body string, a comment — was
 * silently deleted too. Confirmed live: `href="/guides/add-to-cart-2"`
 * became `href="/guides/add-"` (a broken link) and the literal text
 * `"Upgrade path: from-basic-2"` became `"Upgrade path: "` (silently
 * truncated page copy) — neither string has anything to do with a Tailwind
 * gradient class. Scoping every removal to a real className attribute's own
 * class-list text (via the shared bracket-scanner utilities, same technique
 * used throughout lib/build/*) closes that off without weakening gradient
 * detection for any real Tailwind usage shape.
 */
function classNameValueSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const attrRe = /className=/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(code)) !== null) {
    const i = m.index + m[0].length
    const ch = code[i]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      if (end !== -1) spans.push([i + 1, end])
      attrRe.lastIndex = end === -1 ? i + 1 : end + 1
      continue
    }
    if (ch === '{') {
      const end = findMatchingBrace(code, i)
      if (end !== -1) {
        forEachLiteralContent(code, i + 1, end, (s, e) => spans.push([s, e]))
        attrRe.lastIndex = end + 1
      } else {
        attrRe.lastIndex = i + 1
      }
      continue
    }
    // Unrecognized attribute-value shape (bare identifier, etc.) — leave
    // untouched rather than guess at its extent.
  }
  return spans
}

/**
 * Remove all Tailwind gradient classes from code, scoped to real
 * `className` attribute values only (see `classNameValueSpans`).
 */
export function stripGradients(code: string): string {
  const spans = classNameValueSpans(code)
  if (spans.length === 0) return code

  let result = ''
  let cursor = 0
  for (const [start, end] of spans) {
    result += code.slice(cursor, start)
    const original = code.slice(start, end)
    let segment = original
    GRADIENT_PATTERNS.forEach((pattern) => {
      pattern.lastIndex = 0
      segment = segment.replace(pattern, '')
    })
    if (segment !== original) {
      segment = segment.replace(/\s+/g, ' ').trim()
    }
    result += segment
    cursor = end
  }
  result += code.slice(cursor)

  // Clean up className attributes left empty by the removal above.
  result = result.replace(/className=""\s*/g, '')
  result = result.replace(/className='\s*'\s*/g, '')
  result = result.replace(/className="\s+"/g, '')
  result = result.replace(/className=\{`\s*`\}\s*/g, '')
  result = result.replace(/className=\{`\s+`\}/g, '')

  return result
}

/**
 * Detect if code contains gradients
 */
export function hasGradients(code: string): boolean {
  // GRADIENT_PATTERNS are module-level singleton /g regexes, so .test() is
  // stateful across calls: a match leaves lastIndex pointing past it, and
  // the NEXT call (on a different code string) silently starts scanning
  // from there instead of index 0, missing an earlier real match. Resetting
  // lastIndex before each test keeps every call independent of call order.
  return GRADIENT_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(code)
  })
}

/**
 * Get list of gradient classes found in code
 */
export function findGradients(code: string): string[] {
  const found: string[] = []

  GRADIENT_PATTERNS.forEach((pattern) => {
    const matches = code.match(pattern)
    if (matches) {
      found.push(...matches)
    }
  })

  return [...new Set(found)] // Remove duplicates
}

/**
 * Replace gradients with solid color alternatives
 */
export function replaceGradientsWithSolid(code: string): {
  code: string
  replacements: Array<{ original: string; replacement: string }>
} {
  const replacements: Array<{ original: string; replacement: string }> = []
  let cleanedCode = code

  // Common gradient -> solid color mappings
  const gradientToSolid: Record<string, string> = {
    'bg-gradient-to-r from-blue-500 to-purple-600': 'bg-blue-600',
    'bg-gradient-to-br from-purple-600 to-blue-500': 'bg-purple-600',
    'bg-gradient-to-r from-cyan-500 to-blue-500': 'bg-cyan-600',
    'bg-gradient-to-r from-purple-500 to-pink-500': 'bg-purple-600',
    'bg-gradient-to-br from-pink-500 to-orange-400': 'bg-pink-600',
  }

  // Replace known gradient combinations
  Object.entries(gradientToSolid).forEach(([gradient, solid]) => {
    if (cleanedCode.includes(gradient)) {
      cleanedCode = cleanedCode.replace(new RegExp(gradient, 'g'), solid)
      replacements.push({ original: gradient, replacement: solid })
    }
  })

  // For any remaining gradients, just strip them
  cleanedCode = stripGradients(cleanedCode)

  return { code: cleanedCode, replacements }
}
