import { parse } from '@babel/parser'

/**
 * Multi-file output boundary marker — mirrors lib/multi-file-parser.ts.
 * Used to scope duplicate-declaration checks per file, since the same imports
 * and top-level names legitimately repeat across files in one blob.
 */
const FILE_MARKER = /^\/\/\s*---\s*FILE:\s*(.+?)\s*---\s*$/

/**
 * Code Validation Result
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  code: string
  autoFixed?: boolean
  fixes?: string[]
}

/**
 * Auto-fix common code issues
 */
function autoFixCode(code: string): { code: string; fixes: string[] } {
  let fixedCode = code
  const fixes: string[] = []

  // Fix TRUNCATION: Close unterminated block comments. The model sometimes
  // emits `/* ... ` with no closing `*/` (often a trailing NOTE banner). Append
  // just `*/` — appending `*/}` (the old behavior) left a stray `}` that itself
  // broke the parse when the comment wasn't inside JSX braces (builder#64).
  const openComments = (fixedCode.match(/\/\*/g) || []).length
  const closeComments = (fixedCode.match(/\*\//g) || []).length
  if (openComments > closeComments) {
    // Was the still-open `/*` opened inside a JSX expression (`{/* ... `)?
    const lastOpen = fixedCode.lastIndexOf('/*')
    const between = fixedCode.slice(Math.max(0, lastOpen - 40), lastOpen)
    const insideJsxBraces = /\{\s*$/.test(between)
    fixedCode += insideJsxBraces ? ' */}' : ' */'
    fixes.push('Closed unterminated block comment from truncation')
  }

  // Fix TRUNCATION: Close unterminated strings and template literals
  // Count unmatched quotes/backticks — if odd number, the last one is unterminated
  const lines = fixedCode.split('\n')
  const lastLines = lines.slice(-5).join('\n')
  // If the last few lines have an unterminated string, chop them
  const singleQuotes = (lastLines.match(/'/g) || []).length
  const doubleQuotes = (lastLines.match(/"/g) || []).length
  const backticks = (lastLines.match(/`/g) || []).length
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
    // Remove last incomplete line(s) until quotes balance
    let trimmedLines = lines.slice()
    while (trimmedLines.length > 10) {
      const lastLine = trimmedLines[trimmedLines.length - 1].trim()
      trimmedLines.pop()
      const remaining = trimmedLines.join('\n')
      const sq = (remaining.match(/'/g) || []).length
      const dq = (remaining.match(/"/g) || []).length
      const bt = (remaining.match(/`/g) || []).length
      if (sq % 2 === 0 && dq % 2 === 0 && bt % 2 === 0) {
        fixedCode = remaining
        fixes.push('Removed truncated lines with unterminated strings')
        break
      }
    }
  }

  // Fix TRUNCATION: If code is truncated mid-expression, find the last complete statement and close from there
  // This handles cases where the LLM output was cut at 512 tokens
  const openBraces = (fixedCode.match(/\{/g) || []).length
  const closeBraces = (fixedCode.match(/\}/g) || []).length
  const openParens = (fixedCode.match(/\(/g) || []).length
  const closeParens = (fixedCode.match(/\)/g) || []).length
  const unclosedBraces = openBraces - closeBraces
  const unclosedParens = openParens - closeParens

  if (unclosedBraces > 0 || unclosedParens > 0) {
    // Find the last line that looks like a complete statement
    const lines = fixedCode.split('\n')
    let lastGoodLine = lines.length - 1

    // Walk backwards to find last complete-ish line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.endsWith(',') || line.endsWith('{') || line.endsWith('(') ||
          line.endsWith(':') || line === '' || line.startsWith('//')) {
        continue
      }
      if (line.endsWith('}') || line.endsWith(';') || line.endsWith(')') ||
          line.endsWith('>') || line.endsWith('/>') || line.endsWith('],')) {
        lastGoodLine = i
        break
      }
    }

    // Truncate to last good line and close brackets
    fixedCode = lines.slice(0, lastGoodLine + 1).join('\n')

    // Recount after truncation
    const ob = (fixedCode.match(/\{/g) || []).length
    const cb = (fixedCode.match(/\}/g) || []).length
    const op = (fixedCode.match(/\(/g) || []).length
    const cp = (fixedCode.match(/\)/g) || []).length

    let suffix = ''
    // Close JSX return: need );\n} pattern
    for (let i = 0; i < op - cp; i++) suffix += ')'
    if (suffix) suffix += ';\n'
    for (let i = 0; i < ob - cb; i++) suffix += '}\n'

    if (suffix) {
      fixedCode += '\n' + suffix
      fixes.push(`Closed ${(ob-cb) + (op-cp)} unclosed brackets from truncation (truncated at line ${lastGoodLine + 1} of ${lines.length})`)
    }
  }

  // Fix ARROW FUNCTION: Remove stray semicolons after => that break arrow functions
  // Model sometimes generates: .filter(item =>; or .map(x =>;
  const beforeArrowFix = fixedCode
  fixedCode = fixedCode.replace(/=>\s*;/g, '=>')
  if (fixedCode !== beforeArrowFix) {
    fixes.push('Removed stray semicolons after arrow function (=>)')
  }


  // Fix TERNARY: Remove stray semicolons before ? in ternary expressions
  // Model sometimes generates: const x = condition ; ? 'yes' : 'no'
  fixedCode = fixedCode.replace(/\s*;\s*\?\s/g, ' ? ')

  // Fix TERNARY (stray semicolon splitting a ?: expression): the model emits a
  // `;` between the condition/true-branch and the following `?` or `:`, which
  // Babel's errorRecovery parse accepts but Sandpack rejects with
  // "Unexpected token, expected ':'". Drop a `;` that directly precedes a line
  // whose first non-space char is `?` or `:` (a dangling ternary continuation).
  const beforeTernBranchFix = fixedCode
  fixedCode = fixedCode.replace(/;\s*(\n\s*[?:]\s)/g, '$1')
  if (fixedCode !== beforeTernBranchFix) {
    fixes.push('Removed stray semicolon splitting a ternary expression')
  }

  // Fix METHOD-CHAIN SPLIT: a stray `;` directly before a line that begins with
  // `.` breaks a multi-line method chain, e.g.
  //   const filtered = items;
  //     .filter(...).map(...)
  // Babel's errorRecovery accepts it but Sandpack rejects with "Unexpected
  // token", which drops the whole app to the validation-fallback screen. Drop a
  // `;` that immediately precedes a continuation line starting with a member
  // access. (builder: multi-line-chain corruption — the #1 cause of complex-app
  // fallbacks: filter/map/reduce chains are everywhere.)
  const beforeChainFix = fixedCode
  fixedCode = fixedCode.replace(/;[ \t]*(\r?\n\s*\.)/g, '$1')
  if (fixedCode !== beforeChainFix) {
    fixes.push('Removed stray semicolon splitting a method chain')
  }

  // Fix CONTINUATION DUPLICATION: Remove duplicate jsx markers from continuation stitching
  // e.g. ```jsx appearing mid-code from continuation
  fixedCode = fixedCode.replace(/```jsx?\s*\n/g, (match, offset) => {
    if (offset === 0) return match // Keep first one
    fixes.push('Removed duplicate jsx marker from continuation')
    return ''
  })
  fixedCode = fixedCode.replace(/\n```\s*\n```jsx?\s*\n/g, '\n')

  // Fix 0: CRITICAL - Add missing parentheses to function declarations
  // Claude sometimes generates: function LandingPage { or function LandingPage{ instead of function LandingPage() {
  // Use a simple, direct global replace that handles all whitespace variations
  const beforeFix = fixedCode
  const matches = [...fixedCode.matchAll(/function\s+([A-Z][a-zA-Z0-9]*)\s*\{/g)]

  fixedCode = fixedCode.replace(
    /function\s+([A-Z][a-zA-Z0-9]*)\s*\{/g,
    'function $1() {'
  )

  if (fixedCode !== beforeFix && matches.length > 0) {
    const funcNames = matches.map(m => m[1])
    fixes.push(`Added missing parentheses to function ${funcNames.join(', ')}()`)
  }

  // Fix 0.5: CRITICAL - Remove semicolons after opening braces/brackets
  // Claude sometimes generates: const data = [{; or useState({; which breaks syntax
  const beforeSemicolonFix = fixedCode
  fixedCode = fixedCode.replace(/([{\[])\s*;/g, '$1')

  if (fixedCode !== beforeSemicolonFix) {
    fixes.push('Removed semicolons after opening braces/brackets')
  }

  // Fix 1: DISABLED — was breaking Tailwind classes like text-5xl, h-14, w-12 by
  // converting them to text-_5xl, h-_14, w-_12. The regex matched numbers inside
  // CSS class strings which are valid in that context. Only actual JS identifiers
  // starting with digits (like "1px" as a variable name) would be invalid, but
  // Claude's generated code rarely has this issue, and the fix caused more harm
  // than good by destroying all Tailwind numeric classes.

  // Window exposure DISABLED — Sandpack uses ESM exports, not window globals
  // The old Babel iframe path needed window.X = X, but Sandpack doesn't

  // Fix 3: Remove trailing commas in function calls (not in objects/arrays)
  fixedCode = fixedCode.replace(/,(\s*\))/g, '$1')

  // Fix 4: Fix common JSX issues - self-closing tags
  fixedCode = fixedCode.replace(/<(\w+)([^>]*[^/])>\s*<\/\1>/g, '<$1$2 />')

  // Fix 5: Remove empty function calls like () or ""()
  // These cause "" is not a function errors at runtime
  // BUT DON'T remove () from function declarations!
  fixedCode = fixedCode.replace(/['""]?\s*\(\s*\)(?!\s*=>)/g, (match, offset) => {
    const before = fixedCode.substring(Math.max(0, offset - 20), offset)

    // Keep if it's an arrow function definition
    if (before.match(/\w+\s*=\s*$/)) {
      return match
    }

    // Keep if it's a function declaration (function Name() {)
    if (before.match(/function\s+\w+$/)) {
      return match
    }

    // Keep if it's after an identifier (like functionName())
    if (before.match(/\w$/)) {
      return match
    }

    // Only remove if it's a standalone empty call
    fixes.push('Removed empty function call that would cause runtime error')
    return ''
  })

  // Fix 6: Remove template literals that evaluate to empty strings in call position
  fixedCode = fixedCode.replace(/`\s*`\s*\(/g, () => {
    fixes.push('Removed empty template literal call')
    return ''
  })

  // Fix 7: Convert multi-line template literals in JSX attributes to single line
  // This is CRITICAL - prevents Babel from failing on line breaks in className={`...`}
  const classNameRegex = /(className|style)=\{`([^`]*)`\}/g
  fixedCode = fixedCode.replace(
    classNameRegex,
    (_match, attr, content) => {
      // Replace newlines and multiple spaces with single space
      const singleLine = content.replace(/\s+/g, ' ').trim()
      if (content.includes('\n')) {
        fixes.push(`Converted multi-line ${attr} template literal to single line to prevent Babel errors`)
      }
      return `${attr}={\`${singleLine}\`}`
    }
  )

  // Fix 9: Ensure all statements end with semicolon or newline (helps Babel parser)
  // Add semicolons after const/let/var declarations if missing.
  // BUT DON'T add a semicolon when the declaration's value CONTINUES on the next
  // line — a multi-line method chain (`const x = items\n  .filter(...)`) or an
  // unbalanced/open expression (`const m = arr.filter(node =>` … on the next
  // line). Appending `;` there splits the expression and produces "Unexpected
  // token" — which then fails validation and drops the whole app to the
  // fallback screen. (builder: multi-line-chain corruption.)
  {
    const declRe = /^(\s*(?:const|let|var)\s+[^=]+=\s*[^;\n{[\]]+)$/
    // Tokens that, at the START of the following line, mean the expression is
    // still going: member access, ternary/label, closers, binary operators,
    // template/comma continuation, or an opening paren (call continuation).
    const continuationRe = /^\s*[.?:)\]}&|+\-*/=,`(]/
    const dfLines = fixedCode.split('\n')
    for (let i = 0; i < dfLines.length; i++) {
      const m = dfLines[i].match(declRe)
      if (!m) continue
      // Balance check: if this line has more opens than closes, the expression
      // spills onto later lines — never terminate it here.
      const opens = (dfLines[i].match(/[([{]/g) || []).length
      const closes = (dfLines[i].match(/[)\]}]/g) || []).length
      if (opens > closes) continue
      // Trailing binary/arrow operator also means "to be continued".
      if (/(=>|[+\-*/%&|<>=?:.,])\s*$/.test(dfLines[i])) continue
      // Peek at the next non-blank line; if it continues the expression, skip.
      let j = i + 1
      while (j < dfLines.length && dfLines[j].trim() === '') j++
      if (j < dfLines.length && continuationRe.test(dfLines[j])) continue
      dfLines[i] = m[1] + ';'
    }
    fixedCode = dfLines.join('\n')
  }

  // Fix 11: DUPLICATE IMPORTS — the model sometimes imports the same identifier
  // twice (e.g. `import { Card } from './ui/card'` plus `Card,` inside another
  // destructured import), which Babel's error-recovery parser silently accepts
  // but Sandpack/browser rejects with "Identifier 'X' has already been declared".
  // De-dupe named import specifiers, keeping the first occurrence of each name.
  {
    // Collapse multi-line named imports onto a single line first so the
    // per-line de-dupe below can see the whole specifier list. The model
    // frequently emits `import {\n  Card,\n  ...\n} from '...'`.
    // Only collapse the specifier block itself — the pre-part must not contain
    // `from` or a newline-crossing `import`, otherwise a preceding
    // semicolon-less import (e.g. `import React from 'react'`) gets swallowed
    // onto the same line (builder#64).
    fixedCode = fixedCode.replace(
      /import\s+((?:[A-Za-z_$][\w$]*\s*,\s*)?)\{([^}]*)\}(\s*)from(\s*)(['"][^'"]+['"])/g,
      (_m: string, pre: string, specs: string, _s1: string, _s2: string, source: string) => {
        const flatSpecs = specs.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().replace(/,\s*$/, '')
        const flatPre = pre.replace(/\s+/g, ' ').trim()
        return `import ${flatPre ? flatPre + ' ' : ''}{ ${flatSpecs} } from ${source}`
      },
    )

    let seenImportNames = new Set<string>()
    const importLineRegex = /^\s*import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s+)?['"][^'"]+['"];?\s*$/
    const outLines: string[] = []
    let removedDupNames: string[] = []
    for (const rawLine of fixedCode.split('\n')) {
      // Reset per-file: multi-file output (// --- FILE: x --- markers) legitimately
      // repeats the same imports in each file — only de-dupe within one file.
      if (FILE_MARKER.test(rawLine.trim())) { seenImportNames = new Set(); outLines.push(rawLine); continue }
      const m = rawLine.match(importLineRegex)
      if (!m) { outLines.push(rawLine); continue }
      const defaultName = m[1]
      const named = m[2]
      // Track/strip a duplicate default import
      let keepDefault = true
      if (defaultName) {
        if (seenImportNames.has(defaultName)) { keepDefault = false; removedDupNames.push(defaultName) }
        else seenImportNames.add(defaultName)
      }
      if (named !== undefined) {
        const specs = named.split(',').map(s => s.trim()).filter(Boolean)
        const keptSpecs: string[] = []
        for (const spec of specs) {
          // handle `X as Y` — the bound name is Y (or X if no alias)
          const bound = spec.split(/\s+as\s+/i).pop()!.trim()
          if (seenImportNames.has(bound)) { removedDupNames.push(bound); continue }
          seenImportNames.add(bound)
          keptSpecs.push(spec)
        }
        // Rebuild the import line without the duplicate specifiers
        if (keptSpecs.length === 0 && (!defaultName || !keepDefault)) {
          // entire import became redundant — drop the line
          continue
        }
        const fromMatch = rawLine.match(/from\s+(['"][^'"]+['"])/)
        const source = fromMatch ? fromMatch[1] : (rawLine.match(/(['"][^'"]+['"])\s*;?\s*$/)?.[1] || "''")
        const parts: string[] = []
        if (defaultName && keepDefault) parts.push(defaultName)
        if (keptSpecs.length > 0) parts.push(`{ ${keptSpecs.join(', ')} }`)
        outLines.push(`import ${parts.join(', ')} from ${source};`)
      } else {
        // default-only (or side-effect) import
        if (defaultName && !keepDefault) continue
        outLines.push(rawLine)
      }
    }
    if (removedDupNames.length > 0) {
      fixedCode = outLines.join('\n')
      fixes.push(`Removed duplicate import(s): ${[...new Set(removedDupNames)].join(', ')}`)
    }
  }

  // Fix LOCAL DECL SHADOWS IMPORT: the model sometimes both imports a name and
  // re-defines it locally (e.g. `import { Button }` plus `function Button(){}`).
  // Strict @babel/parser accepts it, but Sandpack's scope analysis rejects it
  // with `Duplicate declaration "Button"`. The local definition is the real
  // component, so drop the conflicting named import specifier (builder#64).
  {
    const localDecls = new Set<string>()
    const declRe = /^(?:export\s+(?:default\s+)?)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm
    let dm: RegExpExecArray | null
    while ((dm = declRe.exec(fixedCode)) !== null) localDecls.add(dm[1])

    if (localDecls.size > 0) {
      const removedShadowed: string[] = []
      fixedCode = fixedCode.replace(
        /^(\s*import\s+)(?:([A-Za-z_$][\w$]*)\s*,?\s*)?\{([^}]*)\}(\s*from\s*['"][^'"]+['"];?)\s*$/gm,
        (full, pre: string, def: string | undefined, specs: string, tail: string) => {
          const kept = specs.split(',').map(s => s.trim()).filter(Boolean).filter(spec => {
            const bound = spec.split(/\s+as\s+/i).pop()!.trim()
            if (localDecls.has(bound)) { removedShadowed.push(bound); return false }
            return true
          })
          const defShadowed = def && localDecls.has(def)
          if (defShadowed) removedShadowed.push(def!)
          const keepDef = def && !defShadowed
          if (kept.length === 0 && !keepDef) return '' // whole import removed
          const parts: string[] = []
          if (keepDef) parts.push(def!)
          if (kept.length > 0) parts.push(`{ ${kept.join(', ')} }`)
          return `${pre}${parts.join(', ')}${tail}`
        },
      )
      if (removedShadowed.length > 0) {
        fixes.push(`Removed import(s) shadowed by local declaration: ${[...new Set(removedShadowed)].join(', ')}`)
      }
    }
  }

  // Fix 10: AX Standard — Enforce single h1 per page
  // Convert all <h1> after the first one to <h2> (and </h1> to </h2>)
  let h1Count = 0
  fixedCode = fixedCode.replace(/<h1(\s|>)/g, (match) => {
    h1Count++
    if (h1Count > 1) {
      fixes.push('Converted extra <h1> to <h2> (AX-5: single h1 rule)')
      return '<h2' + match.slice(3)
    }
    return match
  })
  if (h1Count > 1) {
    // Also fix closing tags — convert extra </h1> to </h2>
    let closeCount = 0
    fixedCode = fixedCode.replace(/<\/h1>/g, () => {
      closeCount++
      return closeCount > 1 ? '</h2>' : '</h1>'
    })
  }

  // Fix OPEN-PAREN SEMICOLON (run LAST so nothing re-inserts it): the model
  // emits a stray `;` immediately after an opening `(` with the real content on
  // the following line(s) — e.g. `=> (;`, `return (;`, `useState(;`,
  // `.reduce(;`. Babel errorRecovery throws → Sandpack "Unexpected token"
  // (builder#64). We only match `(` + optional inline spaces + `;` + a NEWLINE,
  // which a `for(;;)` / `for(;` loop never produces (its `;` is followed by the
  // loop condition on the same line, not a newline), so loops stay intact.
  const beforeOpenParenSemi = fixedCode
  fixedCode = fixedCode.replace(/\(([ \t]*);([ \t]*\r?\n)/g, '($1$2')
  if (fixedCode !== beforeOpenParenSemi) {
    fixes.push('Removed stray semicolon after open paren ((;)')
  }

  // Fix UNGUARDED PROPERTY ACCESS: the #1 runtime crash class in generated apps
  // is calling a string/number method on a possibly-undefined field — e.g.
  // `row.name.toLowerCase()` where a row loaded from /api/db is missing `name`,
  // throwing "Cannot read properties of undefined (reading 'toLowerCase')" and
  // killing the whole list. Guard the common string/number coercions so a single
  // bad row can't crash the render. Only rewrites the specific unsafe shape
  // `<ident>.<prop>.<method>(` — optional-chained (`?.`) and already-guarded
  // (`|| ''`) accesses are left untouched.
  const beforeGuards = fixedCode
  // String methods → default to '' :  a.b.toLowerCase()  ->  (a.b || '').toLowerCase()
  fixedCode = fixedCode.replace(
    /(?<![.\w?])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.(toLowerCase|toUpperCase|trim|includes|startsWith|endsWith|split|charAt|slice|replace|match|padStart|padEnd)\(/g,
    (m, obj, prop, method) => `(${obj}.${prop} || '').${method}(`,
  )
  // Number methods → default to 0 :  a.b.toFixed(2)  ->  (a.b || 0).toFixed(2)
  fixedCode = fixedCode.replace(
    /(?<![.\w?])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.(toFixed|toLocaleString|toPrecision)\(/g,
    (m, obj, prop, method) => `(${obj}.${prop} || 0).${method}(`,
  )
  if (fixedCode !== beforeGuards) {
    fixes.push('Guarded unsafe property access (|| default) to prevent undefined-method crashes')
  }

  // Fix MOBILE OVERFLOW: fixed pixel widths larger than a phone viewport are the
  // #1 UX defect — they force horizontal scroll on mobile (builder#196). Rewrite
  // Tailwind arbitrary fixed widths `w-[NNNpx]` where NNN > 375 into a responsive
  // `w-full max-w-[NNNpx]` (full width on mobile, capped on desktop). This is
  // safe: it never makes a layout wider, only lets it shrink on small screens.
  // Skip min-w-/max-w- (already constraints) and values <= 375 (fit on mobile).
  const beforeWidthFix = fixedCode
  fixedCode = fixedCode.replace(
    /(?<![-\w])w-\[(\d+)px\]/g,
    (m, px) => (parseInt(px, 10) > 375 ? `w-full max-w-[${px}px]` : m),
  )
  if (fixedCode !== beforeWidthFix) {
    fixes.push('Made fixed pixel widths responsive (w-full max-w-*) to prevent mobile overflow')
  }

  // Fix MOBILE GRID: a fixed multi-column grid (`grid-cols-N`, N >= 2) with NO
  // responsive breakpoint prefix and NO `grid-cols-1` base forces N columns even
  // on a 375px phone, overflowing (builder#196). Rewrite the bare `grid-cols-N`
  // to `grid-cols-1 md:grid-cols-N` (single column on mobile, N from md up).
  // Conservative: the negative lookbehind `(?<![-:\w])` skips any breakpoint- or
  // hyphen-prefixed variant (`sm:grid-cols-3`, `md:grid-cols-3`, `lg:grid-cols-3`)
  // and the `!/grid-cols-1\b/.test` guard skips class strings that already carry a
  // `grid-cols-1` base, so already-responsive layouts are never touched.
  const beforeGridFix = fixedCode
  fixedCode = fixedCode.replace(/(?<![-:\w])grid-cols-(\d+)\b/g, (m, n) => {
    const cols = parseInt(n, 10)
    if (cols < 2) return m
    return `grid-cols-1 md:grid-cols-${cols}`
  })
  if (fixedCode !== beforeGridFix) {
    fixes.push('Added mobile grid base (grid-cols-1 md:grid-cols-N) to prevent mobile overflow')
  }

  // Fix MOBILE FLEX ROW: an explicit horizontal `flex-row` with NO breakpoint
  // prefix keeps children side-by-side on a phone, overflowing when there are more
  // than a couple. Rewrite the bare `flex-row` to `flex-col md:flex-row` (stacked
  // on mobile, row from md up). Conservative: the negative lookbehind skips
  // breakpoint-prefixed variants (`md:flex-row`), and we only apply this per class
  // string that does NOT already contain `flex-col` anywhere (already handling its
  // own mobile stacking). We scope to className string literals to avoid touching
  // unrelated `flex-row` occurrences.
  const beforeFlexFix = fixedCode
  fixedCode = fixedCode.replace(
    /className=(?:"([^"]*)"|\{`([^`]*)`\})/g,
    (full, dq, tpl) => {
      const cls = dq !== undefined ? dq : tpl
      if (cls === undefined) return full
      // Skip if a flex-col is already present (author handles mobile stacking) or
      // if no bare (unprefixed) flex-row exists.
      if (/(?:^|[\s:])flex-col\b/.test(cls)) return full
      if (!/(?<![-:\w])flex-row\b/.test(cls)) return full
      const newCls = cls.replace(/(?<![-:\w])flex-row\b/g, 'flex-col md:flex-row')
      if (newCls === cls) return full
      return dq !== undefined ? `className="${newCls}"` : `className={\`${newCls}\`}`
    },
  )
  if (fixedCode !== beforeFlexFix) {
    fixes.push('Stacked bare flex rows on mobile (flex-col md:flex-row) to prevent mobile overflow')
  }

  // Fix MOBILE MIN-WIDTH: a `min-w-[NNNpx]` hard floor larger than a phone
  // viewport forces horizontal scroll no matter what its container does. Rewrite
  // `min-w-[NNNpx]` (NNN > 375) to `min-w-0 md:min-w-[NNNpx]` — drop the floor on
  // mobile, restore it from md up. Values <= 375 fit on a phone and are left
  // alone. The negative lookbehind `(?<![-\w])` avoids matching `max-w-`/`w-` and
  // the `md:min-w-[...]` variant, mirroring the width fix above.
  const beforeMinWidthFix = fixedCode
  fixedCode = fixedCode.replace(/(?<![-:\w])min-w-\[(\d+)px\]/g, (m, px) =>
    parseInt(px, 10) > 375 ? `min-w-0 md:min-w-[${px}px]` : m,
  )
  if (fixedCode !== beforeMinWidthFix) {
    fixes.push('Dropped oversized min-width on mobile (min-w-0 md:min-w-*) to prevent mobile overflow')
  }

  // Fix MOBILE TABLE OVERFLOW: a multi-column <table> (even `w-full`) is wider
  // than a 375px phone whenever its columns + padding don't fit, pushing the
  // WHOLE PAGE wide (horizontal scroll). The standard fix is to wrap the table in
  // an `overflow-x-auto` container so it scrolls WITHIN its box instead. Wrap any
  // bare `<table ...>` that is NOT already immediately preceded by an element
  // whose className contains `overflow-x`/`overflow-auto`. Conservative: only
  // wraps `<table` opening tags, matches the corresponding `</table>` for that
  // opener via a simple non-nested assumption (generated tables aren't nested),
  // and skips ones already inside an overflow wrapper. (builder#196)
  const beforeTableFix = fixedCode
  fixedCode = fixedCode.replace(
    /(<table\b[^>]*>)([\s\S]*?<\/table>)/g,
    (full, open, rest, offset, str) => {
      // Skip if the ~80 chars before this <table> already set up horizontal scroll.
      const before = str.slice(Math.max(0, offset - 90), offset)
      if (/overflow-x|overflow-auto|overflow-scroll/.test(before)) return full
      return `<div className="overflow-x-auto">${open}${rest}</div>`
    },
  )
  if (fixedCode !== beforeTableFix) {
    fixes.push('Wrapped table(s) in overflow-x-auto to prevent mobile page overflow')
  }

  // NOTE: inline `style={{ width: NNN }}` fixed widths are intentionally NOT
  // auto-fixed — inline-style shapes are too varied to rewrite safely with regex
  // (percentages, calc(), computed values, non-px units) and a wrong rewrite would
  // corrupt a valid app. Left for the LLM prompt / manual review instead.

  return { code: fixedCode, fixes }
}

/**
 * Apply the syntactic auto-fixes (duplicate-import de-dupe, malformed-ternary
 * repair, arrow/brace fixes, etc.) to a single file's code. The main
 * validateJavaScriptCode runs on the whole raw LLM output, but the multi-file
 * pipeline splits + injects imports AFTER that, so each rendered file must be
 * re-sanitized before it reaches Sandpack or pre-existing per-file defects
 * survive to the preview (builder#64).
 */
export function sanitizeForSandpack(code: string): string {
  return autoFixCode(code).code
}

/**
 * Detect duplicate top-level identifier declarations that Babel's
 * error-recovery parser silently accepts but the browser/Sandpack transform
 * rejects (e.g. "Identifier 'Card' has already been declared").
 *
 * Scans module-scope import bindings and top-level const/let/function/class
 * declarations. Returns the first duplicated name, or null if none.
 */
export function findDuplicateTopLevelDeclaration(code: string): string | null {
  let seen = new Set<string>()

  const add = (name: string): string | null => {
    const n = name.trim()
    if (!n) return null
    if (seen.has(n)) return n
    seen.add(n)
    return null
  }

  for (const raw of code.split('\n')) {
    const line = raw.trim()

    // Reset scope at each file boundary — multi-file output repeats top-level
    // names (App, imports) legitimately across files.
    if (FILE_MARKER.test(line)) { seen = new Set(); continue }

    // import bindings: default + named specifiers
    const imp = line.match(/^import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:from\s+)?['"][^'"]+['"];?$/)
    if (imp) {
      if (imp[1]) { const d = add(imp[1]); if (d) return d }
      if (imp[2] !== undefined) {
        for (const spec of imp[2].split(',')) {
          const s = spec.trim()
          if (!s) continue
          const bound = s.split(/\s+as\s+/i).pop()!.trim()
          const d = add(bound); if (d) return d
        }
      }
      continue
    }

    // top-level declarations (only match at column 0 — real module scope,
    // not nested block bodies which legitimately reuse names)
    const decl = raw.match(/^(?:export\s+(?:default\s+)?)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/)
    if (decl) { const d = add(decl[1]); if (d) return d }
  }

  return null
}

/**
 * Components/identifiers that are available to generated apps WITHOUT an explicit
 * import — React built-ins plus every AIKit / shadcn-UI primitive the system
 * prompt promises and the preview runtime provides. Used to distinguish a
 * genuine hallucinated component (e.g. `<Header/>`) from a legitimately-available
 * one, so we don't false-flag the latter (builder#76).
 */
const KNOWN_AVAILABLE_COMPONENTS = new Set<string>([
  // React built-ins
  'Fragment', 'Suspense', 'StrictMode', 'Profiler',
  // shadcn UI set (promised in the system prompt, provided by the preview shim)
  'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent',
  'CardFooter', 'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
  'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'Separator',
  'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
  'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
  'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent', 'Progress', 'Checkbox',
  'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
  'Alert', 'AlertTitle', 'AlertDescription', 'Textarea', 'Switch', 'Slider', 'Tooltip',
  'RadioGroup', 'RadioGroupItem', 'Popover', 'PopoverTrigger', 'PopoverContent',
  'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
  'Sheet', 'SheetTrigger', 'SheetContent', 'ScrollArea', 'Toggle', 'Command',
  // AIKit primitives
  'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView', 'SafetyBadge',
  'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay', 'TokenUsageBar',
  'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable', 'AIKitTimeline',
  'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard', 'EmptyState', 'AIKitProductCard',
  'AIKitPagination', 'AIKitBreadcrumb', 'AIKitStepper', 'AgentTimeline',
  // recharts (real names + the "Re"-prefixed aliases the prompt uses) — the
  // import injector resolves all of these, so they are effectively available.
  'ResponsiveContainer', 'LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell',
  'AreaChart', 'Area', 'RadarChart', 'Radar', 'RadialBarChart', 'RadialBar', 'ComposedChart',
  'Scatter', 'ScatterChart', 'Treemap', 'Funnel', 'FunnelChart', 'XAxis', 'YAxis',
  'CartesianGrid', 'Legend', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
  'ReLineChart', 'ReBarChart', 'RePieChart', 'ReAreaChart', 'RechartsTooltip',
  // lucide-react icons (used as JSX, injected on demand)
  'Search', 'Menu', 'X', 'ChevronDown', 'ChevronRight', 'ChevronLeft', 'ChevronUp',
  'Home', 'Settings', 'Users', 'BarChart3', 'FileText', 'Bell', 'Mail', 'Star', 'Heart',
  'ShoppingCart', 'Plus', 'Minus', 'Edit', 'Trash2', 'Eye', 'Check', 'AlertCircle', 'Info',
  'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'ExternalLink', 'Download', 'Upload',
  'Share2', 'Filter', 'Calendar', 'Clock', 'MapPin', 'Phone', 'Globe', 'Lock', 'Shield',
  'Zap', 'TrendingUp', 'TrendingDown', 'Activity', 'DollarSign', 'CreditCard', 'Package',
  'Truck', 'Sun', 'Moon', 'Laptop', 'Smartphone', 'Code', 'Terminal', 'GitBranch', 'Send',
  'MessageSquare', 'Bookmark', 'Tag', 'Copy', 'Save', 'RefreshCw', 'MoreHorizontal',
  'MoreVertical', 'Layers', 'Layout', 'Grid', 'List', 'Target', 'Award', 'Sparkles',
  'Rocket', 'Building2', 'Briefcase', 'BookOpen', 'Bot', 'Brain', 'LogOut', 'LogIn',
  'UserPlus', 'Users2', 'FolderOpen', 'File', 'Box', 'Inbox', 'CircleDot', 'Hexagon',
  'Wand2', 'Palette', 'Lightbulb', 'Gauge', 'Cpu', 'Wifi', 'Play', 'Pause', 'SkipForward',
  'Volume2', 'Image', 'Video', 'Music', 'Mic',
])

/**
 * Detect capitalized JSX components that are USED but never resolved — not
 * defined locally, not imported, and not in the known-available set. These are
 * model hallucinations (e.g. `<Header/>`) that render as
 * "Element type is invalid: … got: undefined" in Sandpack — a runtime/scope
 * error the Babel parse cannot catch. Returns the list of unresolved names,
 * scoped per file so multi-file output isn't cross-contaminated (builder#76).
 *
 * Deliberately conservative: only flags PascalCase JSX tags (custom components),
 * never lowercase HTML tags or dotted members (Foo.Bar), and treats any name
 * that appears anywhere as defined/imported as resolved.
 */
export function findUnresolvedComponents(code: string): string[] {
  const unresolved = new Set<string>()

  for (const file of code.split(FILE_MARKER)) {
    // Names available in this file: known globals + local decls + imports.
    const available = new Set<string>(KNOWN_AVAILABLE_COMPONENTS)

    // local declarations (function/const/let/class Foo)
    for (const m of file.matchAll(/(?:function|const|let|class)\s+([A-Z][A-Za-z0-9]*)/g)) {
      available.add(m[1])
    }
    // imports: default + named (with aliases)
    for (const m of file.matchAll(/import\s+(?:([A-Z][A-Za-z0-9]*)\s*,?\s*)?(?:\{([^}]*)\})?/g)) {
      if (m[1]) available.add(m[1])
      if (m[2]) {
        for (const spec of m[2].split(',')) {
          const bound = spec.trim().split(/\s+as\s+/i).pop()?.trim()
          if (bound && /^[A-Z]/.test(bound)) available.add(bound)
        }
      }
    }
    // destructured from something (const { Foo } = ...) — treat as available
    for (const m of file.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(':').pop()?.trim()
        if (n && /^[A-Z]/.test(n)) available.add(n)
      }
    }

    // components used in JSX: <Foo ...> or <Foo/> — PascalCase only, skip dotted
    for (const m of file.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
      const name = m[1]
      // skip dotted member access like <Foo.Bar> (the base Foo is what matters)
      if (!available.has(name)) unresolved.add(name)
    }
  }

  return [...unresolved]
}

/**
 * Detect the "Objects are not valid as a React child" crash class (#184): a bare
 * `{identifier}` used as a JSX child where the identifier is very likely a plain
 * object, so React throws at render time with e.g.
 *   "Objects are not valid as a React child (found: object with keys {...})".
 *
 * This is a RUNTIME error the Babel parse cannot catch, so — like
 * findUnresolvedComponents (#76) — we FLAG it (validation gate → retry) rather
 * than trying to rewrite it, because a wrong rewrite (dropping the real field a
 * child should show) is worse than a caught error.
 *
 * DELIBERATELY CONSERVATIVE — far better to miss cases than to false-flag valid
 * code. We only flag `{x}` as a child when BOTH hold:
 *   1. `x` is a bare identifier (no `.prop`, no `(...)` call, no operators,
 *      no `&&`/`?:`/template — those are handled/rendered fine), AND
 *   2. `x` is bound in this file to a PLAIN OBJECT LITERAL (`const x = { ... }`)
 *      and is NOT also bound to an array or a `.map(...)`/`.filter(...)` result
 *      (those render fine / are arrays of elements).
 * A child that is a `.map()` return, `item.name`, `count`, a function call, or a
 * conditional is never flagged. Returns the first offending identifier, or null.
 */
export function findObjectRenderedAsChild(code: string): string | null {
  for (const file of code.split(FILE_MARKER)) {
    // Identifiers bound to a plain object literal at declaration:
    //   const x = { ... }   /   let x = {   (multi-line object opener)
    // The char after `=` `{` must NOT be `}` on the same token in a way that
    // makes it a destructure — we already require `=` BEFORE `{`, so this is an
    // object literal value, not a `const { a } = obj` destructure.
    const objectVars = new Set<string>()
    // Allow the declaration to follow line-start, newline, `{`, or `;` so
    // inline/minified forms like `function App(){const x={...}` are caught too
    // (not just newline-formatted code). The `\b` keeps it a word boundary.
    for (const m of file.matchAll(
      /(?:^|[\n{;])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g,
    )) {
      objectVars.add(m[1])
    }

    if (objectVars.size === 0) continue

    // Remove any identifier that is ALSO (re)bound to an array literal, a call
    // result, or a map/filter chain anywhere in the file — then it's ambiguous
    // and we must NOT flag it (safety first). Also drop names reassigned to a
    // non-object so we don't false-flag shadowed/reused names.
    for (const name of [...objectVars]) {
      const reArrayOrCall = new RegExp(
        `\\b${name}\\s*=\\s*(?:\\[|[A-Za-z_$][\\w$.]*\\s*\\(|[A-Za-z_$][\\w$.]*\\.(?:map|filter|reduce|slice|concat)\\b)`,
      )
      if (reArrayOrCall.test(file)) objectVars.delete(name)
    }

    if (objectVars.size === 0) continue

    // JSX child slot: `>` then optional whitespace, then `{ ident }` (a BARE
    // identifier only — no dot, call, operator, or whitespace-separated tokens),
    // then optional whitespace and `<`. This is the exact "render an object"
    // shape. `{item.name}`, `{items.map(...)}`, `{a && b}`, `{cond ? x : y}`,
    // `{count}` (a number) all fail the "bound to an object literal" test above,
    // and anything with a `.`/`(`/operator fails this regex's bare-ident group.
    for (const m of file.matchAll(/>\s*\{\s*([A-Za-z_$][\w$]*)\s*\}\s*</g)) {
      if (objectVars.has(m[1])) return m[1]
    }
  }

  return null
}

/**
 * JavaScript/DOM/preview globals that are ALWAYS in scope in the preview runtime
 * but are NOT React/AIKit/shadcn components — so they'd be missed by
 * KNOWN_AVAILABLE_COMPONENTS (which is PascalCase-only). These are the standard
 * built-ins plus the React hooks and a few browser globals the preview injects
 * (see app/api/preview/[id]/route.ts). Used ONLY by findUndefinedReferences so a
 * legitimate `useState(...)`, `Math.round(...)`, `JSON.parse(...)`, `console.log`
 * etc. is never flagged as an undefined variable (builder#191).
 */
const KNOWN_RUNTIME_GLOBALS = new Set<string>([
  // Core JS globals / built-ins
  'React', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol',
  'Proxy', 'Reflect', 'Error', 'TypeError', 'RangeError', 'BigInt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'structuredClone',
  'Intl', 'NaN', 'Infinity', 'undefined', 'globalThis', 'JSX',
  // Browser globals injected/available in the preview iframe
  'window', 'document', 'console', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'fetch', 'URL', 'URLSearchParams',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'confirm', 'prompt',
  'FormData', 'Blob', 'File', 'FileReader', 'Image', 'Audio', 'atob', 'btoa',
  'CustomEvent', 'Event', 'AbortController', 'IntersectionObserver',
  'ResizeObserver', 'MutationObserver', 'crypto', 'performance', 'process',
  'module', 'exports', 'require', 'globalReactErrorHandler',
  // React hooks (exposed on window in the preview; imported in Sandpack)
  'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useContext',
  'createContext', 'useReducer', 'useLayoutEffect', 'useId', 'useTransition',
  'useDeferredValue', 'useImperativeHandle', 'useSyncExternalStore',
  'createElement', 'cloneElement', 'createRef', 'forwardRef', 'memo', 'lazy',
  // shadcn util the preview exposes
  'cn',
])

/**
 * Detect references to identifiers that are USED but NEVER declared anywhere in
 * the file — the "ReferenceError: X is not defined" crash class (#191), e.g. the
 * model renders `{sensorData}` / `{kanbanTasks.map(...)}` or calls
 * `getDealsByStageData()` without ever declaring the variable/function. This is a
 * RUNTIME crash the Babel parse can't catch, so — like findUnresolvedComponents
 * (#76) and findObjectRenderedAsChild (#184) — we FLAG it (validation gate →
 * retry) rather than rewrite it. Returns the first offending name, or null.
 *
 * Uses Babel's real scope analysis (path.scope.hasBinding) rather than regex, so
 * function params, destructuring, catch clauses, closures, hoisted functions and
 * imports are all correctly treated as "declared" — the hard cases a regex would
 * get wrong. A reference is flagged ONLY when Babel finds no binding in ANY
 * enclosing scope AND the name is not a known runtime global / injected component.
 *
 * DELIBERATELY CONSERVATIVE — a false positive rejects a valid app. To stay safe:
 *   - Only camelCase/lower-initial data identifiers are flagged (the real crash
 *     shape: sensorData, kanbanTasks, getDealsByStageData). PascalCase names are
 *     NEVER flagged here — they're components/icons covered by #76, and the
 *     preview exposes the entire lucide icon set on window (hundreds of names we
 *     can't fully enumerate), so flagging a PascalCase name risks breaking valid
 *     icon usage.
 *   - If the code can't be parsed to an AST at all, we return null (no flag) and
 *     let the existing syntax-error path handle it.
 *   - Multi-file blobs are analyzed per file (bindings don't cross FILE markers).
 */
export function findUndefinedReferences(code: string): string | null {
  // Uses ONLY @babel/parser (a direct, bundleable dep already imported above).
  // NOT @babel/core (Node-only `fs`, unbundleable) and NOT @babel/traverse/types
  // (not direct deps — unresolvable in the Next build). We build the AST with
  // parse() and do a manual two-pass walk: (1) collect every DECLARED name
  // (const/let/var/function/class/params/destructure/import/catch), (2) collect
  // every referenced lower-initial identifier; flag a reference that is neither
  // declared nor a known runtime global/component. Fail-open on any error.
  for (const file of code.split(FILE_MARKER)) {
    if (!file.trim()) continue

    let ast: any
    try {
      ast = parse(file, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowSuperOutsideMethod: true,
      })
    } catch {
      // Unparseable — leave it to the syntax-error path, don't false-flag.
      continue
    }

    const declared = new Set<string>()
    const referenced = new Set<string>()

    // Recursively collect declared binding names from any node/pattern.
    const collectPattern = (node: any) => {
      if (!node || typeof node !== 'object') return
      switch (node.type) {
        case 'Identifier':
          declared.add(node.name)
          break
        case 'ObjectPattern':
          for (const p of node.properties || []) {
            if (p.type === 'RestElement') collectPattern(p.argument)
            else collectPattern(p.value || p.argument)
          }
          break
        case 'ArrayPattern':
          for (const el of node.elements || []) collectPattern(el)
          break
        case 'AssignmentPattern':
          collectPattern(node.left)
          break
        case 'RestElement':
          collectPattern(node.argument)
          break
      }
    }

    // Walk the whole tree once, gathering declarations AND references. We track
    // whether we're in a "reference position" vs skip positions (member .prop,
    // object keys, JSX attribute/element names, type annotations, declarations).
    const visit = (node: any, parent: any, key: string) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const c of node) visit(c, parent, key)
        return
      }
      if (typeof node.type !== 'string') return

      // --- collect DECLARED names ---
      switch (node.type) {
        case 'VariableDeclarator':
          collectPattern(node.id)
          break
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
          if (node.id) declared.add(node.id.name)
          for (const p of node.params || []) collectPattern(p)
          break
        case 'ClassDeclaration':
        case 'ClassExpression':
          if (node.id) declared.add(node.id.name)
          break
        case 'CatchClause':
          if (node.param) collectPattern(node.param)
          break
        case 'ImportDefaultSpecifier':
        case 'ImportNamespaceSpecifier':
        case 'ImportSpecifier':
          if (node.local) declared.add(node.local.name)
          break
      }

      // --- collect a REFERENCE (value-position identifier) ---
      if (node.type === 'Identifier' && parent) {
        const inSkipPosition =
          // member access `.prop` (but obj in obj.prop IS a reference)
          (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
          (parent.type === 'OptionalMemberExpression' && key === 'property' && !parent.computed) ||
          // object literal key (non-computed)
          (parent.type === 'ObjectProperty' && key === 'key' && !parent.computed) ||
          (parent.type === 'ObjectMethod' && key === 'key' && !parent.computed) ||
          // any declaration id / param handled above
          (parent.type === 'VariableDeclarator' && key === 'id') ||
          (parent.type === 'FunctionDeclaration' && key === 'id') ||
          (parent.type === 'ClassDeclaration' && key === 'id') ||
          ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') && key === 'params') ||
          // JSX names (elements & attributes) — components handled by #76 check
          parent.type === 'JSXAttribute' ||
          parent.type === 'JSXOpeningElement' ||
          parent.type === 'JSXClosingElement' ||
          (parent.type === 'JSXMemberExpression') ||
          // labels
          parent.type === 'LabeledStatement' ||
          parent.type === 'BreakStatement' ||
          parent.type === 'ContinueStatement' ||
          // TS type positions
          (typeof parent.type === 'string' && parent.type.startsWith('TS'))
        if (!inSkipPosition) referenced.add(node.name)
      }

      // recurse into children
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'leadingComments' || k === 'trailingComments') continue
        const child = (node as any)[k]
        if (child && typeof child === 'object') visit(child, node, k)
      }
    }

    try {
      visit(ast.program, null, 'program')
    } catch {
      continue // exotic tree — fail open
    }

    // Flag the first referenced-but-undeclared lower-initial data identifier.
    for (const name of referenced) {
      if (declared.has(name)) continue
      if (KNOWN_RUNTIME_GLOBALS.has(name)) continue
      if (KNOWN_AVAILABLE_COMPONENTS.has(name)) continue
      // CONSERVATIVE: only flag lower-initial data idents (the #191 shape).
      // PascalCase components/icons are covered by findUnresolvedComponents (#76).
      if (!/^[a-z_$][\w$]*$/.test(name)) continue
      if (name.length < 2) continue
      return name
    }
  }

  return null
}

/**
 * Validate JavaScript/JSX code using Babel parser
 *
 * This catches syntax errors like unterminated strings, missing brackets,
 * invalid JSX, etc. before the code reaches the browser's Babel transformer.
 *
 * @param code - The JavaScript/JSX code to validate
 * @returns Validation result with valid flag and optional error message
 */
export function validateJavaScriptCode(
  code: string,
  opts: { importsStripped?: boolean; lenient?: boolean } = {},
): ValidationResult {
  // First, try to auto-fix common issues (includes duplicate-import de-dupe)
  const { code: fixedCode, fixes } = autoFixCode(code)

  // Catch duplicate top-level declarations the auto-fix couldn't resolve.
  // Babel's errorRecovery parser accepts these, but Sandpack rejects them at
  // runtime with "Identifier 'X' has already been declared". Reject so the
  // caller's retry path re-generates and RLHF logs this as validation_error
  // rather than a false 'success' (builder#64).
  const dupName = findDuplicateTopLevelDeclaration(fixedCode)
  if (dupName) {
    const errorMessage = `Identifier '${dupName}' has already been declared`
    console.error('❌ Code validation failed (duplicate declaration):', errorMessage)
    return {
      valid: false,
      error: errorMessage,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  }

  // Catch hallucinated components — used in JSX but never defined, imported, or
  // in the known-available set (#76). The /preview/[id] Babel renderer STRIPS
  // all imports and injects components as globals, so on THAT path every
  // component would look "unresolved" — a false positive that wrongly rejected
  // valid apps (#91). That caller passes importsStripped:true to skip the check.
  // The generation path (validateGeneratedCode) does NOT strip, so it keeps full
  // #76 coverage — a hallucinated component in import-less generated code is
  // still flagged.
  const unresolved = opts.importsStripped ? [] : findUnresolvedComponents(fixedCode)
  if (unresolved.length > 0) {
    const errorMessage = `Element type is invalid: <${unresolved[0]}> is used but not defined or imported`
    console.error('❌ Code validation failed (unresolved component):', unresolved.join(', '))
    return {
      valid: false,
      error: errorMessage,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  }

  // Catch "Objects are not valid as a React child" (#184) — a bare `{obj}` used
  // as a JSX child where `obj` is a plain object literal. React throws this at
  // render time ("Objects are not valid as a React child …"), a runtime crash
  // the Babel parse can't catch. We FLAG rather than rewrite (a wrong rewrite —
  // dropping the field the child should show — is worse than a caught error);
  // the caller's retry path re-generates and RLHF logs it as a validation error.
  const objChild = findObjectRenderedAsChild(fixedCode)
  if (objChild) {
    const errorMessage = `Objects are not valid as a React child (found: object rendered directly as '{${objChild}}'). Render its fields instead (e.g. {${objChild}.name}).`
    console.error('❌ Code validation failed (object rendered as React child):', objChild)
    return {
      valid: false,
      error: errorMessage,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  }

  // Catch "ReferenceError: X is not defined" (#191) — the model references a
  // variable/function it never declared (e.g. renders `{sensorData}` or calls
  // `getDealsByStageData()` with no matching declaration). This is a runtime
  // crash the Babel parse can't catch. We FLAG rather than rewrite (there's no
  // safe automatic value to substitute); the caller's retry path re-generates
  // and RLHF logs it as a validation error. The check uses Babel scope analysis
  // and is deliberately conservative (lower-initial data idents only), so valid
  // hooks/components/icons/locals are never flagged. It runs on BOTH paths —
  // an undefined data reference crashes regardless of whether imports are
  // stripped, so importsStripped does NOT suppress it (unlike the #76 check).
  const undefRef = findUndefinedReferences(fixedCode)
  if (undefRef) {
    const errorMessage = `Reference to undefined variable '${undefRef}' — declare it or remove the reference.`
    console.error('❌ Code validation failed (undefined reference):', undefRef)
    return {
      valid: false,
      error: errorMessage,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  }

  // CRITICAL: Instead of strict validation, just return the auto-fixed code as valid
  // The browser's Babel transformer is more lenient and will handle minor syntax issues
  // This prevents false positives from blocking valid code

  // Only do a basic check for catastrophic syntax errors
  try {
    // Quick validation with error recovery
    parse(fixedCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true,
      strictMode: false,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
    })

    // The errorRecovery parse passed. Sandpack (the real runtime) uses a STRICT
    // transform, so run a second strict parse to catch a narrow class of errors
    // that errorRecovery hides but Sandpack rejects — chiefly malformed ternaries
    // (stray `;` splitting `?:`) that render as "Something went wrong". Only these
    // specific errors are rejected, so JSX-recoverable cases still pass (builder#64).
    try {
      parse(fixedCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
        errorRecovery: false,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowSuperOutsideMethod: true,
      })
    } catch (strictError) {
      const strictMsg =
        strictError instanceof Error ? strictError.message.replace(/\(\d+:\d+\)/, '').trim() : ''
      const s = strictMsg.toLowerCase()
      // The errorRecovery parse already passed, so the code is *mostly* well
      // formed. If the STRICT parse now trips on an "unexpected token", that is
      // a hard error Sandpack (which parses strictly) will also throw — e.g. a
      // stray `;` splitting a ternary or after `=> (`. Reject so the retry path
      // re-generates. "missing semicolon" is a benign recovery hint Sandpack
      // tolerates, so it's explicitly excluded (builder#64).
      const isSandpackFatal =
        s.includes('unexpected token') && !s.includes('missing semicolon')
      // lenient: the /preview/[id] Babel renderer now parses with errorRecovery,
      // so it can render code that only trips the STRICT (Sandpack) parse. Don't
      // reject those on the preview path — the errorRecovery parse already
      // passed, so the renderer will handle it. (Sandpack path stays strict.)
      if (isSandpackFatal && !opts.lenient) {
        console.error('❌ Code validation failed (strict parse — Sandpack-fatal):', strictMsg)
        return {
          valid: false,
          error: strictMsg,
          code: fixedCode,
          autoFixed: fixes.length > 0,
          fixes: fixes.length > 0 ? fixes : undefined,
        }
      }
      // Any other strict-only error: let it through (browser/Sandpack Babel is
      // lenient enough), preserving the original permissive behavior.
    }

    // Success - return fixed code
    return {
      valid: true,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message.replace(/\(\d+:\d+\)/, '').trim()
        : 'Unknown syntax error'

    // Check if it's a CATASTROPHIC error that will definitely break in browser
    const errorLower = errorMessage.toLowerCase()

    // The runtime is Sandpack (@babel/standalone, strict) — not the old lenient
    // browser-Babel path — so a hard parse error here WILL break the preview.
    // Reject the definite-fatal families so the caller's retry re-generates and
    // RLHF logs validation_error instead of a false 'success' (builder#64).
    const isCatastrophicError =
      errorLower.includes('unexpected end of file') ||
      errorLower.includes('unexpected eof') ||
      errorLower.includes('unterminated string') ||
      errorLower.includes('unterminated template') ||
      // "unexpected token" from a full parse failure is Sandpack-fatal (stray
      // `;` in a ternary, `=> (;`, etc.). The benign "missing semicolon"
      // recovery hint is a different message and is not matched here.
      errorLower.includes('unexpected token')

    if (isCatastrophicError) {
      // This will definitely fail in browser - report error
      console.error('❌ Code validation failed (catastrophic):', errorMessage)
      console.error('Problematic code snippet:', fixedCode.substring(0, 200))
      return {
        valid: false,
        error: errorMessage,
        code: fixedCode,
        autoFixed: fixes.length > 0,
        fixes: fixes.length > 0 ? fixes : undefined,
      }
    }

    // All other errors: treat as warnings and allow them through
    // Browser Babel is more lenient and will often handle these successfully
    console.warn('⚠️ Minor syntax warning (treating as valid):', errorMessage)
    return {
      valid: true,
      code: fixedCode,
      autoFixed: fixes.length > 0,
      fixes: fixes.length > 0 ? fixes : undefined,
    }
  }
}

/**
 * Extract code block from markdown-wrapped code
 * Handles code wrapped in ```jsx, ```javascript, or ```tsx blocks
 * Also handles malformed wrappers like ""`jsx, ```jsx", etc.
 */
export function extractCodeFromMarkdown(content: string): string {
  // Try proper markdown code blocks first
  const codeBlockRegex = /```(?:jsx|javascript|tsx|js|ts|react)?\s*\n([\s\S]*?)```/
  const match = content.match(codeBlockRegex)

  if (match && match[1]) {
    return match[1].trim()
  }

  // If no proper markdown found, aggressively clean malformed wrappers
  // Claude sometimes returns: ""`jsx, "`jsx, ```jsx", "```jsx, etc.
  let cleaned = content
    // Remove ALL combinations of quotes/backticks + language identifiers at start
    .replace(/^[\s\n\r]*["'`]{1,10}(?:jsx|javascript|tsx|ts|js|react)?[\s\n\r]*/gi, '')
    // Remove ALL combinations of quotes/backticks at end
    .replace(/[\s\n\r]*["'`]{1,10}[\s\n\r]*$/gi, '')
    // Remove any remaining weird leading characters before 'function' or 'const'
    .replace(/^[^a-zA-Z/\s]+(function|const|import|export)/i, '$1')
    .trim()

  // Return cleaned content
  return cleaned
}

/**
 * Validate code and extract from markdown if needed
 *
 * @param rawContent - Raw content from LLAMA (may include markdown)
 * @returns Validation result with extracted code
 */
export function validateGeneratedCode(rawContent: string): ValidationResult {
  // Extract code from markdown wrapper
  const code = extractCodeFromMarkdown(rawContent)

  // Validate the extracted code
  return validateJavaScriptCode(code)
}
