/**
 * Attempts to fix common JSX syntax errors from AI-generated code.
 * Not perfect, but catches the most frequent issues.
 */

export function fixJsxErrors(code: string): string {
  let fixed = code

  // Fix 1: Balance unclosed JSX tags
  fixed = balanceJsxTags(fixed)

  // Fix 2: Remove trailing content after the component (like stray backticks, markdown)
  fixed = removeTrailingNoise(fixed)

  // Fix 3: Fix common syntax issues
  fixed = fixCommonSyntax(fixed)

  return fixed
}

/**
 * Attempt to balance mismatched JSX tags.
 * Tracks open/close tags and inserts missing closing tags.
 */
function balanceJsxTags(code: string): string {
  // Simple approach: find self-closing component tags and ensure they're properly closed
  // This catches the most common issue: <CardContent> ... </Card> (should be </CardContent></Card>)

  const lines = code.split('\n')
  const tagStack: string[] = []
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find opening JSX tags (not self-closing, not closing)
    const openTags = line.matchAll(/<([A-Z][A-Za-z0-9]*)(?:\s[^>]*)?(?<!\/)\s*>/g)
    for (const match of openTags) {
      tagStack.push(match[1])
    }

    // Find self-closing tags — don't add to stack
    const selfClosing = line.matchAll(/<([A-Z][A-Za-z0-9]*)(?:\s[^>]*)?\s*\/>/g)
    for (const _match of selfClosing) {
      // These are fine, no stack change
    }

    // Find closing tags
    const closeTags = line.matchAll(/<\/([A-Z][A-Za-z0-9]*)\s*>/g)
    for (const match of closeTags) {
      const closeTag = match[1]
      const lastOpen = tagStack[tagStack.length - 1]

      if (lastOpen === closeTag) {
        // Perfect match
        tagStack.pop()
      } else if (tagStack.includes(closeTag)) {
        // Mismatched — insert closing tags for everything between
        const insertTags: string[] = []
        while (tagStack.length > 0 && tagStack[tagStack.length - 1] !== closeTag) {
          insertTags.push(`</${tagStack.pop()}>`)
        }
        if (tagStack.length > 0) {
          tagStack.pop() // pop the matching tag
        }
        // Insert the missing closing tags before this line
        if (insertTags.length > 0) {
          result.push(insertTags.join('\n'))
        }
      }
    }

    result.push(line)
  }

  // Close any remaining open tags at the end
  while (tagStack.length > 0) {
    result.push(`</${tagStack.pop()}>`)
  }

  return result.join('\n')
}

/**
 * Remove trailing markdown/noise after the component code.
 */
function removeTrailingNoise(code: string): string {
  // Remove trailing ``` or markdown that Claude sometimes appends
  let fixed = code.replace(/```\s*$/, '')

  // Remove lines after "export default" that look like markdown
  const lines = fixed.split('\n')
  let lastCodeLine = lines.length - 1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('```') || line.startsWith('---') || line.startsWith('##') || line.startsWith('Note:')) {
      lastCodeLine = i - 1
    } else if (line.length > 0) {
      break
    }
  }

  return lines.slice(0, lastCodeLine + 1).join('\n')
}

/**
 * Fix common syntax errors in AI-generated code.
 */
function fixCommonSyntax(code: string): string {
  let fixed = code

  // Fix: const x = (; → const x = (
  fixed = fixed.replace(/=\s*\(\s*;/g, '= (')

  // Fix: useMemo(() => ; → useMemo(() =>
  fixed = fixed.replace(/=>\s*;/g, '=>')

  // Fix: double semicolons
  fixed = fixed.replace(/;;\s*$/gm, ';')

  // Fix: window.X = X; at end (from old preview system)
  fixed = fixed.replace(/^window\.[A-Z]\w+\s*=\s*[A-Z]\w+;?\s*$/gm, '')

  return fixed
}
