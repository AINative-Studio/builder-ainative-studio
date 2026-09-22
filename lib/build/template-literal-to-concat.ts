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
 */
export function convertTemplateLiteralAttrsToConcat(code: string): string {
  const templateLiteralRegex = /(className|style)=\{`([^`]*)`\}/g
  return code.replace(templateLiteralRegex, (_match, attr: string, content: string) => {
    if (!content.includes('${')) {
      const singleLine = content.replace(/\s+/g, ' ').trim()
      return `${attr}={\`${singleLine}\`}`
    }

    const parts = content.split(/(\$\{[^}]+\})/)
    const convertedParts = parts
      .map((part: string) => {
        if (part.startsWith('${') && part.endsWith('}')) {
          // THE FIX: parenthesize the interpolated expression so `+` can
          // never reach inside a ternary/logical-and/anything else it binds
          // tighter than.
          return `(${part.slice(2, -1).trim()})`
        }
        if (part) {
          const cleaned = part.replace(/\s+/g, ' ')
          return cleaned ? `"${cleaned}"` : ''
        }
        return ''
      })
      .filter((p: string) => p !== '')

    return `${attr}={${convertedParts.join(' + ')}}`
  })
}
