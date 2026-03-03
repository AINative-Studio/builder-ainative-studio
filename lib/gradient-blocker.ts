/**
 * Gradient Blocker Utility
 * Removes Tailwind gradient classes from generated code
 */

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
 * Remove all Tailwind gradient classes from code
 */
export function stripGradients(code: string): string {
  let cleanedCode = code

  // Remove gradient classes
  GRADIENT_PATTERNS.forEach((pattern) => {
    cleanedCode = cleanedCode.replace(pattern, '')
  })

  // Clean up multiple spaces left after removal
  cleanedCode = cleanedCode.replace(/className="([^"]*\s{2,}[^"]*)"/g, (match, classes) => {
    return `className="${classes.replace(/\s+/g, ' ').trim()}"`
  })

  // Clean up empty className attributes
  cleanedCode = cleanedCode.replace(/className=""\s*/g, '')
  cleanedCode = cleanedCode.replace(/className="\s+"/g, '')

  return cleanedCode
}

/**
 * Detect if code contains gradients
 */
export function hasGradients(code: string): boolean {
  return GRADIENT_PATTERNS.some((pattern) => pattern.test(code))
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
