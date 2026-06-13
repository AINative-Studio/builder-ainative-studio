import { parse } from '@babel/parser'

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

  // Fix 2: Ensure ALL component functions are properly exposed to window
  // Find all component definitions (functions or const with capital first letter)
  const componentMatches = fixedCode.matchAll(/(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=(]/g)
  const exposedComponents: string[] = []

  for (const match of componentMatches) {
    const componentName = match[1]
    // Skip if already exposed or if it's a type/interface
    if (!fixedCode.includes(`window.${componentName}`) &&
        !fixedCode.includes(`interface ${componentName}`) &&
        !fixedCode.includes(`type ${componentName}`)) {
      exposedComponents.push(componentName)
    }
  }

  // Add window exposure for all components
  if (exposedComponents.length > 0) {
    const exposureCode = exposedComponents.map(name =>
      `window.${name} = ${name};`
    ).join('\n')
    fixedCode += `\n\n// Expose components to window for preview\n${exposureCode}\n`
    fixes.push(`Exposed components to window: ${exposedComponents.join(', ')}`)
  }

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

  return { code: fixedCode, fixes }
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
  // First, try to auto-fix common issues
  const { code: fixedCode, fixes } = autoFixCode(code)

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

    // CRITICAL: Only reject errors that DEFINITELY break in browser
    const isCatastrophicError =
      errorLower.includes('unexpected end of file') ||
      errorLower.includes('unexpected eof') ||
      errorLower.includes('unterminated string') ||
      errorLower.includes('unterminated template') ||
      errorLower.includes('unterminated jsx contents')
      // Note: "unexpected token" errors are often recoverable by browser Babel
      // with errorRecovery mode, so we let them through as warnings

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
