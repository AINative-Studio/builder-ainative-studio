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
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      if (end === -1) return -1
      i = end + 1
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
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      const realEnd = end === -1 ? code.length - 1 : end
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
