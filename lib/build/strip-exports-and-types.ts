/**
 * Strip `export` keywords and a handful of basic TypeScript type annotations
 * from a generated component's code before it's injected into the
 * non-module `<script>` tag the legacy single-file preview renderers
 * (app/api/preview/[id]/route.ts, app/api/preview/route.ts) use.
 *
 * Real bug this guards against, same comment/string-blindness class already
 * fixed across obedience-gate.ts / output-validator.ts / jsx-fixer.ts /
 * flatten-multifile.ts / etc.: both routes previously ran
 * `.replace(/export\s+(default\s+)?/g, '')` and, in app/api/preview/[id]/
 * route.ts, `.replace(/:\s*(React\.FC(<.*?>)?|any|string|number|boolean)/g,
 * '')` directly against the RAW, unmasked component source — global regexes
 * with no line anchor, so a match anywhere in the text was rewritten,
 * including inside a quoted string or template literal.
 *
 * A generated landing/docs page routinely displays example code or plain
 * copy as a quoted string or template literal — e.g. a pricing/FAQ string
 * like `"Note: any discount code"` or `` `Invoice #: number pending` ``, or
 * an API-product page's own demo snippet showing `export default function
 * Example() {...}` as literal instructional text. The unmasked regexes
 * above silently mangled that displayed text (stripping the `: any` /
 * `: number` / `export ` substring out of it) while also doing their
 * intended job on the real top-level `export`/type-annotation syntax —
 * corrupting founder-facing content without ever throwing an error.
 *
 * Fixed by masking string/template-literal content and comments before
 * each regex runs, and only applying a match whose exact span is
 * byte-identical between the raw and masked code (i.e. contains no
 * string/comment content at all) — same safeReplace pattern
 * lib/build/flatten-multifile.ts already uses for this file's sibling
 * export-stripping logic.
 */

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
 * Position-preserving mask: every char inside a single/double-quoted
 * string, a template literal (including its `${}` delimiters, left as-is
 * so a real interpolated identifier is unaffected), or a `//`/`/* *\/`
 * comment becomes a space (newlines left as real newlines), so the regexes
 * below can be safely applied while still reporting correct match offsets.
 */
function maskStringsCommentsAndTemplates(code: string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(code, i, ch)
      if (end === -1) {
        out += ch + code.slice(i + 1).replace(/[^\n]/g, ' ')
        i = code.length
        continue
      }
      out += ch + code.slice(i + 1, end).replace(/[^\n]/g, ' ') + ch
      i = end + 1
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
 * untouched.
 */
function safeReplace(code: string, regex: RegExp, replacement: string): string {
  const masked = maskStringsCommentsAndTemplates(code)
  return code.replace(regex, (...args: unknown[]) => {
    const match = args[0] as string
    const offset = args[args.length - 2] as number
    const maskedSlice = masked.slice(offset, offset + match.length)
    if (maskedSlice !== match) return match
    return replacement
  })
}

/**
 * Remove `export`/`export default` keywords and a handful of basic
 * TypeScript type annotations (`: React.FC<...>`, `: React.FC`, `: any`,
 * `: string`, `: number`, `: boolean`) so the code can run as a plain,
 * non-module `<script>` body. Comment/string/template-literal-safe — see
 * this module's doc comment.
 */
export function stripExportsAndBasicTypes(code: string): string {
  let out = safeReplace(code, /export\s+default\s+/g, '')
  out = safeReplace(out, /export\s+/g, '')
  out = safeReplace(out, /:\s*React\.FC<.*?>/g, '')
  out = safeReplace(out, /:\s*React\.FC/g, '')
  out = safeReplace(out, /:\s*any/g, '')
  out = safeReplace(out, /:\s*string/g, '')
  out = safeReplace(out, /:\s*number/g, '')
  out = safeReplace(out, /:\s*boolean/g, '')
  return out
}
