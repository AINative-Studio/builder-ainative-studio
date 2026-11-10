/**
 * Convert `className`/`style` template-literal JSX attributes with `${}`
 * interpolation into plain string concatenation (builder — real, live bug
 * fix, found on a real customer's app, agentive-product/#844 follow-up).
 *
 * WHY THIS EXISTS: the client-side Babel-standalone preview renderer chokes
 * on some `${}` interpolation shapes inside JSX template-literal attributes,
 * so `/api/preview/[id]` pre-converts `className={\`...${x}...\`}` to
 * `className={"..." + x + "..."}` before handing the code to Babel.
 *
 * THE BUG THIS FIXES (confirmed live, agentive-product's real generated
 * code): the naive join used a bare `' + '` with NO parentheses around the
 * interpolated expression. When that expression is itself a ternary — an
 * extremely common React pattern for conditional classes, e.g.
 * `${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}` — the result was:
 *
 *   "static prefix " + sidebarOpen ? 'translate-x-0' : '-translate-x-full'
 *
 * `+` binds tighter than `?:` in JS, so this parses as
 * `("static prefix " + sidebarOpen) ? 'translate-x-0' : '-translate-x-full'`
 * — a non-empty string is always truthy, so the ternary's condition is
 * ALWAYS true regardless of `sidebarOpen`'s real value, and the ENTIRE
 * static prefix (every other class on the element — `fixed`, sizing,
 * colors, `md:hidden`, everything) is silently discarded. Reproduced
 * exactly: a real customer's mobile nav `<aside>` rendered with a
 * `className` of just `"translate-x-0"`, permanently full-width and
 * in-flow instead of off-canvas, because THIS conversion — not the
 * generated source, which was correct — corrupted it at serve time.
 *
 * THE FIX: wrap every interpolated expression in parentheses when joining,
 * so `+` concatenation always operates on the whole ternary's RESULT, not
 * just its first operand:
 *
 *   "static prefix " + (sidebarOpen ? 'translate-x-0' : '-translate-x-full')
 *
 * This is correct for every interpolation shape (plain identifiers, member
 * expressions, ternaries, `&&`, function calls, nested template literals) —
 * parenthesizing an already-simple expression is always a no-op.
 *
 * #1643 FOLLOW-UP BUG: locating the outer template literal and each `${}`
 * interpolation inside it originally used flat regexes (`` [^`]* `` /
 * `\$\{[^}]+\}`) that cannot cross a `}` or a backtick that appears INSIDE
 * the interpolated expression itself — e.g. an inline object-literal arg to
 * a `cn()`/`clsx()` call (`` ${isActive ? cn({active: true}) : 'x'} ``, an
 * extremely common conditional-class pattern in this exact codebase's own
 * shadcn/Tailwind ecosystem) or a nested template literal
 * (`` ${open ? `${extra}-open` : 'closed'} ``). The flat scan stopped at the
 * FIRST `}`/backtick — inside the nesting, not the interpolation's real end
 * — so the join spliced static text and expression fragments at the wrong
 * boundary, producing a hard SyntaxError (unbalanced parens/braces) that
 * crashes the entire preview compile, the exact blank-page class this file
 * exists to prevent. Fixed by depth-counting the braces (and skipping over
 * nested strings/template literals while counting) to find each
 * interpolation's TRUE extent instead of assuming it is itself brace-free.
 *
 * #1710: the local findMatchingBrace/findBacktickEnd/findStringEnd helpers
 * this file used to define are now the shared lib/build/bracket-scanner.ts
 * utility (imported below) — this file was one of over a dozen independent,
 * near-identical reimplementations of the same string/comment-aware
 * bracket-matching technique.
 *
 * STRING-BLIND TOP-LEVEL SCAN BUG: `attrOpenRe` below used to scan the raw
 * `code` for its `className={` + backtick trigger text directly. A generated
 * app that shows example/tutorial markup as a plain string (e.g. a code
 * "cheat sheet" component, extremely plausible given this is a landing-page
 * generator), such as `"Try: className={\`bg-${color}-500\`}"`, contains
 * that exact trigger text as DATA, not real JSX. The old scan matched it
 * anyway, and `findBacktickEnd`/the content extraction below happily "fixed"
 * it as if it were real, splicing a raw `"` into the middle of the
 * surrounding string literal — corrupting otherwise-correct code into an
 * unescaped-quote SyntaxError that fails the whole Babel compile and blanks
 * the preview. Fixed by scanning a same-length, comment-and-quoted-string-
 * masked twin of `code` for match POSITIONS only; every actual read/slice
 * below still operates on the real, unmasked `code`.
 */
import { findMatchingBrace, findBacktickEnd, findStringEnd } from './bracket-scanner'

/**
 * Blanks out `"..."`/`'...'` string bodies and `//`/`/* *\/` comments
 * (preserving length/offsets) so the top-level `attrOpenRe` scan below can't
 * mistake literal `className={\`...\`}` TEXT sitting inside an unrelated
 * string or comment for a real JSX attribute. Backtick template literals are
 * left untouched — that's exactly what the scan needs to see.
 */
function maskQuotedStringsAndCommentsForAttrScan(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      const realEnd = end === -1 ? code.length - 1 : end
      out += ' '.repeat(realEnd - i + 1)
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

export function convertTemplateLiteralAttrsToConcat(code: string): string {
  const masked = maskQuotedStringsAndCommentsForAttrScan(code)
  const attrOpenRe = /(className|style)=\{`/g
  let result = ''
  let cursor = 0
  let m: RegExpExecArray | null

  while ((m = attrOpenRe.exec(masked)) !== null) {
    const attr = m[1]
    const backtickIdx = m.index + m[0].length - 1
    const closeBacktickIdx = findBacktickEnd(code, backtickIdx)

    if (closeBacktickIdx === -1 || code[closeBacktickIdx + 1] !== '}') {
      // Can't safely locate the end of this template literal (unbalanced
      // input) — leave it untouched rather than guess at a wrong boundary.
      attrOpenRe.lastIndex = m.index + m[0].length
      continue
    }

    const content = code.slice(backtickIdx + 1, closeBacktickIdx)
    result += code.slice(cursor, m.index) + buildReplacement(attr, content)
    cursor = closeBacktickIdx + 2
    attrOpenRe.lastIndex = cursor
  }

  result += code.slice(cursor)
  return result
}

function buildReplacement(attr: string, content: string): string {
  if (!content.includes('${')) {
    const singleLine = content.replace(/\s+/g, ' ').trim()
    return `${attr}={\`${singleLine}\`}`
  }

  const parts = splitTemplateLiteralContent(content)
  const convertedParts = parts
    .map((part) => {
      if (part.type === 'expr') {
        // THE FIX: parenthesize the interpolated expression so `+` can
        // never reach inside a ternary/logical-and/anything else it binds
        // tighter than.
        return `(${part.value.trim()})`
      }
      const cleaned = part.value.replace(/\s+/g, ' ')
      return cleaned ? `"${cleaned}"` : ''
    })
    .filter((p) => p !== '')

  return `${attr}={${convertedParts.join(' + ')}}`
}

/** A template literal's content split into alternating static-text and `${}`-expression parts, in source order. */
function splitTemplateLiteralContent(
  content: string,
): Array<{ type: 'text' | 'expr'; value: string }> {
  const parts: Array<{ type: 'text' | 'expr'; value: string }> = []
  let i = 0
  let textStart = 0

  while (i < content.length) {
    if (content[i] === '\\') {
      i += 2
      continue
    }
    if (content[i] === '$' && content[i + 1] === '{') {
      if (i > textStart) parts.push({ type: 'text', value: content.slice(textStart, i) })
      const closeIdx = findMatchingBrace(content, i + 1)
      const end = closeIdx === -1 ? content.length : closeIdx
      parts.push({ type: 'expr', value: content.slice(i + 2, end) })
      i = end + 1
      textStart = i
      continue
    }
    i++
  }
  if (textStart < content.length) parts.push({ type: 'text', value: content.slice(textStart) })

  return parts
}

// findMatchingBrace/findBacktickEnd are now imported from ./bracket-scanner (#1710).
