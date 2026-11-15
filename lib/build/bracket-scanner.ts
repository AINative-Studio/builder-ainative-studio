/**
 * Shared, string/template-literal/comment-aware bracket-matching utility
 * (#1710).
 *
 * Over the last several days this exact technique — depth-count a `(`/`)`,
 * `{`/`}`, or `<`/`>` pair while treating string literals, template
 * literals, and comments as opaque so a stray bracket-shaped character
 * INSIDE one (an emoticon in placeholder copy, a comparison-operator string
 * type like `'>' | '<'`, a code comment that merely mentions a bracket) is
 * never mistaken for real bracket-relevant syntax — was independently
 * reinvented and independently fixed, one file and one edge case at a time,
 * across more than a dozen near-identical issues/PRs (#1637, #1654, #1662,
 * #1675, #1686, #1688, #1690, #1692, #1694, #1696, #1698, #1700, #1701,
 * #1704, #1706, #1708, ...). See #1710 for the full audit.
 *
 * This module is the single place that technique now lives. Every call site
 * that used to hand-roll its own depth counter should delegate here instead
 * (keeping its own exported function name/signature as a thin wrapper, so
 * callers elsewhere in the codebase never need to change) — so the NEXT
 * edge case anyone finds (a new comment shape, a new escape sequence) gets
 * fixed in exactly one place instead of up to a dozen.
 *
 * Deliberately NOT a general-purpose JS/TSX tokenizer — just enough opacity
 * (strings, template literals incl. nested `${}` interpolation, line
 * comments and block comments, `\`-escapes) to stop a depth counter from being fooled
 * by bracket-shaped characters that aren't really bracket syntax. Only
 * meaningful for scanning real source code — NOT appropriate for scanning
 * prose/markdown text, where an apostrophe or a `//` in a URL is not string
 * or comment syntax at all (see lib/build/deck-model.ts's findMatchingParen,
 * which scans markdown link syntax and deliberately does NOT use this).
 */

/**
 * Index of the closing `quote` character that ends the string literal
 * starting at `openIdx` (which must point at the opening quote), honoring
 * `\`-escapes. Returns -1 if unterminated.
 */
export function findStringEnd(code: string, openIdx: number, quote: string): number {
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

/**
 * Index of the closing backtick that ends the template literal starting at
 * `openIdx` (which must point at the opening backtick), honoring
 * `\`-escapes and recursively skipping over nested `${...}` interpolations
 * (whose own closing `}` is found via real brace-depth counting — the
 * interpolation's CONTENTS are live code, not literal template text).
 * Returns -1 if unterminated.
 */
export function findBacktickEnd(code: string, openIdx: number): number {
  let i = openIdx + 1
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') return i
    if (ch === '$' && code[i + 1] === '{') {
      const closeIdx = findMatchingBracket(code, i + 1, '{', '}')
      if (closeIdx === -1) return -1
      i = closeIdx + 1
      continue
    }
    i++
  }
  return -1
}

/**
 * True when the `'` at `idx` can be ruled out as a real string-literal
 * opener because it's almost certainly an apostrophe inside JSX/plain text
 * — an English contraction immediately after a word character ("We're",
 * "don't", "Let's"); `foo'bar'` isn't valid JS, so a `'` right after a
 * word character can never legitimately open a real string. Shared by
 * every quote-aware scanner below so the #2053 fix lives in one place.
 */
function isFakeApostrophe(code: string, idx: number): boolean {
  const prev = code[idx - 1]
  return code[idx] === "'" && prev !== undefined && /[A-Za-z0-9_$]/.test(prev)
}

/**
 * Resolves whether the `"`/`'` at `idx` is a genuine string-literal opener
 * and, if so, where it closes — or rules it out as a fake open entirely
 * (returns `null`), in which case callers should treat the quote character
 * itself as ordinary text/code rather than skipping anything.
 *
 * Two independent ways a quote can be fake, both found live in generated
 * marketing copy:
 *  - `isFakeApostrophe` above (a contraction).
 *  - The ONLY candidate closing quote `findStringEnd` can find is on a
 *    LATER LINE. A real single/double-quoted JS string literal can never
 *    contain a raw, unescaped newline (that's a syntax error outside
 *    template literals) — so if the nearest same-quote character is past a
 *    line break, this open was never a real string either (e.g. a decade
 *    reference like "the '90s" with no closing `'` until some unrelated
 *    string many lines later). Without this check, the scanner would skip
 *    everything in between as "string content" — silently un-blanking real
 *    comments (maskComments) or swallowing real bracket characters and
 *    reporting a false "unbalanced" (findMatchingBracket), exactly #2034/
 *    #2053's bug class but via a different trigger.
 *
 * A genuinely truncated/unterminated string — no matching quote anywhere,
 * AND the file ends on the same line it opened on (nothing after it to have
 * been misread) — is NOT considered fake; that's still reported via
 * `end: -1` so existing truncation-handling callers keep their behavior.
 * But a `'`/`"` with no same-line close that's followed by MORE lines of
 * real file content (e.g. a lone decade apostrophe, nothing else in the
 * whole file happens to use that quote character) is exactly as fake as
 * one whose only candidate close is on a later line — there's no real
 * string here either way, just no close ever appears to prove it.
 */
export function resolveStringOpen(code: string, idx: number, quote: string): { end: number } | null {
  if (isFakeApostrophe(code, idx)) return null
  const end = findStringEnd(code, idx, quote)
  const nl = code.indexOf('\n', idx)
  if (end === -1) {
    // No close anywhere. Genuine truncation only if there's no more file
    // left after this line either — otherwise this was never a real open.
    return nl === -1 ? { end: -1 } : null
  }
  if (nl !== -1 && nl < end) return null
  return { end }
}

/**
 * Index of the matching `closeChar` bracket for the `openChar` bracket at
 * `openIdx` (which must point at `openChar`), honoring arbitrarily nested
 * brackets of that same kind. Returns -1 if unbalanced.
 *
 * While scanning, single/double-quoted strings, backtick template literals
 * (including nested `${}` interpolation), `//` line comments, and `/* ...
 * *` + `/` block comments are all treated as opaque spans that never
 * contribute to depth and are never themselves mistaken for `openChar`/
 * `closeChar` — this is the one property every call site in this codebase
 * has independently needed and independently reinvented (see module doc).
 *
 * `openChar`/`closeChar` are typically `(`/`)`, `{`/`}`, or `<`/`>` — any
 * single-character pair works, as long as neither collides with `"`, `'`,
 * `` ` ``, or `\`.
 */
export function findMatchingBracket(
  code: string,
  openIdx: number,
  openChar: string,
  closeChar: string,
): number {
  let depth = 0
  let i = openIdx
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i)
      i = nl === -1 ? code.length : nl + 1
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end === -1 ? code.length : end + 2
      continue
    }
    if (ch === '/' && isRegexLiteralStart(code, i)) {
      const end = findRegexLiteralEnd(code, i)
      if (end !== -1) {
        i = end + 1
        continue
      }
      // Unterminated as a regex (e.g. a stray division `/` this heuristic
      // misjudged, or genuinely broken source) — fall through and let `/`
      // scan as an ordinary, non-bracket character rather than failing the
      // whole match.
    }
    if (ch === '"' || ch === "'") {
      const resolved = resolveStringOpen(code, i, ch)
      if (resolved === null) {
        i++
        continue
      }
      if (resolved.end === -1) return -1
      i = resolved.end + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      if (end === -1) return -1
      i = end + 1
      continue
    }
    if (ch === openChar) {
      depth++
      i++
      continue
    }
    if (ch === closeChar) {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    i++
  }
  return -1
}

/**
 * Blanks out `//` and `/* ... *\/` comments (replacing their characters with
 * spaces, preserving length/newlines) while leaving string/template-literal
 * CONTENTS untouched. The canonical home for a technique that was
 * independently reinvented, byte-for-byte identical, across 7 separate files
 * (#1893's audit) — design-conformance.ts, preview-engine.ts,
 * output-validator.ts, primitive-wiring.ts, seed-check.ts, obedience-gate.ts,
 * and dedupe-provided-components.ts, plus completeness-gate.ts's own
 * near-identical copy (one extra bare-backslash branch, folded in here as a
 * strict superset — it only changes output for a standalone `\` outside any
 * string/comment, which doesn't occur in valid generated code). Each of
 * those files now re-exports this as a thin local `maskComments` so their
 * existing call sites never needed to change.
 *
 * Deliberately NOT merged with the several other mask* variants still living
 * in lib/code-validator.ts, lib/component-detector.ts,
 * lib/sandpack/build-files.ts, lib/build/flatten-multifile.ts, and
 * lib/sandpack/jsx-fixer.ts — those have genuine behavioral divergences
 * (string-content masking on/off, collapsing vs. length-preserving output)
 * that need a deliberate opt-in design, not a byte-identical swap; see
 * #1893 for the full audit before touching any of those.
 */
export function maskComments(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '\\') {
      out += code.slice(i, i + 2)
      i += 2
      continue
    }
    // #2053/#2034-class guard (see resolveStringOpen's doc above this
    // function) — a `'`/`"` that isn't really opening a string (a
    // contraction, or a decade-style apostrophe whose only candidate close
    // is past a line break) is left as an ordinary character instead of
    // being treated as a string-open that swallows real comments as if
    // they were string content.
    if (ch === '"' || ch === "'") {
      const resolved = resolveStringOpen(code, i, ch)
      if (resolved === null) {
        out += ch
        i++
        continue
      }
      const realEnd = resolved.end === -1 ? code.length - 1 : resolved.end
      out += code.slice(i, realEnd + 1)
      i = realEnd + 1
      continue
    }
    if (ch === '`') {
      const end = findBacktickEnd(code, i)
      const realEnd = end === -1 ? code.length - 1 : end
      out += code.slice(i, realEnd + 1)
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
 * Keywords/operators after which a bare `/` is (almost) always a regex
 * literal's opening delimiter rather than division — used by
 * isRegexLiteralStart() below. Deliberately not exhaustive: a false
 * negative here just leaves findMatchingBracket's pre-existing (non-regex-
 * aware) behavior in place for that one `/`, which is no worse than before
 * this fix; a false POSITIVE would make findRegexLiteralEnd swallow real
 * code as if it were regex content, which is strictly worse — so this list
 * only grows with cases confirmed safe, never speculatively.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'yield', 'case', 'do', 'await', 'extends',
])

/**
 * Whether the `/` at `slashIdx` starts a regex literal rather than being a
 * division operator — a classic JS ambiguity this scanner must resolve
 * without a real tokenizer. Heuristic: look back past whitespace to the
 * last significant character; a `/` right after an operator/punctuation
 * (`(`, `,`, `=`, `!`, `&&`, `||`, etc.) or one of REGEX_PRECEDING_KEYWORDS
 * is a regex start, a `/` right after an identifier/number/`)`/`]`/`}` is
 * division.
 *
 * `<` and `>` are deliberately EXCLUDED from the "regex follows" set even
 * though they're ordinary binary operators too: in this (TSX-heavy)
 * codebase a `/` directly after `<` is overwhelmingly a JSX closing tag
 * (`</Foo>`), never `a < /regex/`, and misreading that as a regex start
 * would make findRegexLiteralEnd swallow real JSX markup looking for a
 * closing `/` — a strictly worse bug than the one this function exists to
 * fix. Treating `</Foo>` as "not a regex" just falls back to this scanner's
 * pre-existing behavior for the `/`, which is safe (it isn't a bracket
 * character either way).
 */
function isRegexLiteralStart(code: string, slashIdx: number): boolean {
  let j = slashIdx - 1
  while (j >= 0 && /\s/.test(code[j])) j--
  if (j < 0) return true
  const prevChar = code[j]
  if (prevChar === '<' || prevChar === '>') return false
  if ('([{,;:=&|!?+-*%^~'.includes(prevChar)) return true
  if (/[A-Za-z0-9_$]/.test(prevChar)) {
    let k = j
    while (k >= 0 && /[A-Za-z0-9_$]/.test(code[k])) k--
    return REGEX_PRECEDING_KEYWORDS.has(code.slice(k + 1, j + 1))
  }
  return false
}

/**
 * Index of the last character (the closing `/`, or a trailing flag letter
 * after it) of the regex literal starting at `openIdx` (which must point at
 * the opening `/`), honoring `\`-escapes and `[...]` character classes
 * (where an unescaped `/` does NOT end the literal). Returns -1 if
 * unterminated (a regex literal can't span a newline).
 */
function findRegexLiteralEnd(code: string, openIdx: number): number {
  let i = openIdx + 1
  let inClass = false
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') return -1
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') {
      inClass = true
      i++
      continue
    }
    if (ch === ']') {
      inClass = false
      i++
      continue
    }
    if (ch === '/' && !inClass) {
      let end = i
      while (end + 1 < code.length && /[a-zA-Z]/.test(code[end + 1])) end++
      return end
    }
    i++
  }
  return -1
}

/** Index of the `)` matching the `(` at `openIdx`, or -1 if unbalanced. */
export function findMatchingParen(code: string, openIdx: number): number {
  return findMatchingBracket(code, openIdx, '(', ')')
}

/** Index of the `}` matching the `{` at `openIdx`, or -1 if unbalanced. */
export function findMatchingBrace(code: string, openIdx: number): number {
  return findMatchingBracket(code, openIdx, '{', '}')
}

/**
 * Index of the `>` matching the `<` at `openIdx`, or -1 if unbalanced.
 *
 * Callers are expected to only invoke this at a position already known to
 * be a TS generic/type-annotation `<` (e.g. right after `React.FC`, or a
 * type annotation's `:`) — this function doesn't itself distinguish that
 * from a JSX tag or a `<`/`>` comparison operator; it only adds string/
 * template-literal/comment opacity on top of the same depth-counting shape
 * every existing call site already relied on for that distinction.
 */
export function findMatchingAngleBracket(code: string, openIdx: number): number {
  return findMatchingBracket(code, openIdx, '<', '>')
}
