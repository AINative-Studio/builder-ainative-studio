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

  // Fix TRUNCATION: Close unterminated JSX comments from LLM truncation
  const openComments = (fixedCode.match(/\/\*/g) || []).length
  const closeComments = (fixedCode.match(/\*\//g) || []).length
  if (openComments > closeComments) {
    fixedCode += ' */}'
    fixes.push('Closed unterminated JSX comment from truncation')
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
  // Add semicolons after const/let/var declarations if missing
  // BUT DON'T add semicolons after opening braces/brackets!
  fixedCode = fixedCode.replace(/^(\s*(?:const|let|var)\s+[^=]+=\s*[^;\n{[\]]+)$/gm, '$1;')

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
 * Validate JavaScript/JSX code using Babel parser
 *
 * This catches syntax errors like unterminated strings, missing brackets,
 * invalid JSX, etc. before the code reaches the browser's Babel transformer.
 *
 * @param code - The JavaScript/JSX code to validate
 * @returns Validation result with valid flag and optional error message
 */
export function validateJavaScriptCode(code: string): ValidationResult {
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
      if (isSandpackFatal) {
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
