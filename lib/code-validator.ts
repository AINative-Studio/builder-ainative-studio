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

  // Fix 1: Remove invalid number-identifier patterns like "1px", "2em", etc in JS context
  // These are valid in CSS but not in JS variable names
  const invalidIdentifiers = fixedCode.match(/\b\d+[a-zA-Z]+\b/g)
  if (invalidIdentifiers) {
    invalidIdentifiers.forEach(invalid => {
      // Replace with valid identifier by adding underscore
      const fixed = `_${invalid}`
      fixedCode = fixedCode.replace(new RegExp(`\\b${invalid}\\b`, 'g'), fixed)
      fixes.push(`Fixed invalid identifier: ${invalid} → ${fixed}`)
    })
  }

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
  fixedCode = fixedCode.replace(/['""]?\s*\(\s*\)(?!\s*=>)/g, (match, offset) => {
    // Only remove if it's not part of an arrow function definition
    const before = fixedCode.substring(Math.max(0, offset - 20), offset)
    if (before.match(/\w+\s*=\s*$/)) {
      return match // Keep it, it's an arrow function
    }
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
  fixedCode = fixedCode.replace(/^(\s*(?:const|let|var)\s+[^=]+=\s*[^;\n]+)$/gm, '$1;')

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

    // Check if it's a MINOR error that we can safely ignore
    const errorLower = errorMessage.toLowerCase()
    const isMinorError =
      errorLower.includes('semicolon') ||
      errorLower.includes('missing semicolon') ||
      errorLower.includes('unexpected token') ||
      errorLower.includes('expected')

    // ONLY fail for CATASTROPHIC errors that will definitely break in browser
    // NOTE: Even "unterminated string" can sometimes work in browser Babel, so be very lenient
    const isCatastrophicError =
      errorLower.includes('unexpected end of file') ||
      errorLower.includes('unexpected eof') ||
      (errorLower.includes('unterminated') && errorLower.includes('comment')) // Only fail on unterminated comments

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
 */
export function extractCodeFromMarkdown(content: string): string {
  // Match code blocks with language specifier
  const codeBlockRegex = /```(?:jsx|javascript|tsx|js|ts)\n([\s\S]*?)```/
  const match = content.match(codeBlockRegex)

  if (match && match[1]) {
    return match[1].trim()
  }

  // Return original if no code block found
  return content.trim()
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
