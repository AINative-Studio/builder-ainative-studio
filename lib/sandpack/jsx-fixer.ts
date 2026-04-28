/**
 * Attempts to fix common JSX syntax errors from AI-generated code.
 * Not perfect, but catches the most frequent issues.
 */

export function fixJsxErrors(code: string): string {
  let fixed = code

  // Fix 0: Rewrite @/ path aliases — Sandpack doesn't support tsconfig path aliases
  fixed = fixed.replace(/from ['"]@\/components\//g, "from './components/")
  fixed = fixed.replace(/from ['"]@\/lib\//g, "from './lib/")
  fixed = fixed.replace(/from ['"]@\//g, "from './")

  // Fix 0b: Rewrite barrel imports that Sandpack can't resolve
  fixed = rewriteBarrelImports(fixed)

  // Fix 0c: Rewrite hallucinated package names to known equivalents
  fixed = rewriteHallucinatedPackages(fixed)

  // Fix 0d: Sanitize broken/overlapping imports (most common AI generation error)
  fixed = sanitizeImports(fixed)

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

/**
 * Rewrite barrel imports that Sandpack can't resolve.
 * AI often generates `import { X, Y } from './components'` or `from '../components'`
 * which assumes a barrel file (index.ts) that doesn't exist in Sandpack.
 * We rewrite these to import from the known AIKit/shadcn/lucide sources.
 */
function rewriteBarrelImports(code: string): string {
  // Match imports from bare './components' or '../components' (no subpath)
  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/components['"]\s*;?/g,
    (_match, names: string) => {
      const components = names.split(',').map((n: string) => n.trim()).filter(Boolean)

      // Known AIKit components
      const aikitNames = new Set([
        'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
        'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
        'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
        'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
        'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
        'AIKitStepper', 'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
      ])
      // Known shadcn components
      const shadcnNames = new Set([
        'Button', 'Card', 'CardHeader', 'CardContent', 'CardTitle', 'CardDescription', 'CardFooter',
        'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback', 'Input', 'Label',
        'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
        'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
        'Separator', 'Progress', 'CircularProgress',
        'Alert', 'AlertTitle', 'AlertDescription',
        'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
        'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
        'Checkbox', 'RadioGroup', 'RadioGroupItem',
        'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
      ])
      // Known recharts components
      const rechartsNames = new Set([
        'ResponsiveContainer', 'LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell',
        'AreaChart', 'Area', 'RadarChart', 'Radar', 'RadialBarChart', 'RadialBar',
        'ComposedChart', 'Scatter', 'ScatterChart', 'XAxis', 'YAxis', 'CartesianGrid',
        'Tooltip', 'Legend', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
      ])

      const aikit: string[] = []
      const shadcn: string[] = []
      const recharts: string[] = []
      const unknown: string[] = []

      for (const c of components) {
        if (aikitNames.has(c)) aikit.push(c)
        else if (shadcnNames.has(c)) shadcn.push(c)
        else if (rechartsNames.has(c)) recharts.push(c)
        else unknown.push(c)
      }

      const imports: string[] = []
      if (aikit.length > 0) imports.push(`import { ${aikit.join(', ')} } from './components/aikit'`)
      if (shadcn.length > 0) imports.push(`import { ${shadcn.join(', ')} } from './components/ui/card'`)
      if (recharts.length > 0) imports.push(`import { ${recharts.join(', ')} } from 'recharts'`)
      // Unknown components — still import from aikit as best guess
      if (unknown.length > 0) imports.push(`import { ${unknown.join(', ')} } from './components/aikit'`)

      return imports.join('\n')
    }
  )
}

/**
 * Rewrite hallucinated package names to known Sandpack-available equivalents.
 * Only targets packages that are clearly invented/non-existent (e.g. 'AINativePrimitives').
 * Real packages like 'aikit', '@ainative/react-sdk', etc. are preserved.
 */
function rewriteHallucinatedPackages(code: string): string {
  // Only rewrite packages that are clearly fake — ones with made-up suffixes.
  // Observed hallucinations: 'AINativePrimitives', 'AINativeComponents', 'AINativeUI'
  // These are bare unscoped strings that don't match any real npm package.
  // Real packages to PRESERVE: 'aikit', '@ainative/react-sdk', '@ainative/next-sdk', etc.
  const hallucinatedPatterns = [
    /^AINativePrimitives$/,
    /^AINativeComponents$/,
    /^AINativeUI$/,
    /^AINativeKit$/,
    /^AIKitPrimitives$/,
    /^AIKitComponents$/,
  ]

  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([A-Za-z][\w/-]*)['"](\s*;?)/g,
    (match, names: string, pkg: string, semi: string) => {
      const isHallucinated = hallucinatedPatterns.some(p => p.test(pkg))
      if (!isHallucinated) return match
      const components = names.split(',').map((n: string) => n.trim()).filter(Boolean)
      return `import { ${components.join(', ')} } from './components/aikit'${semi}`
    }
  )
}

/**
 * Sanitize broken/overlapping import statements.
 * AI models sometimes generate incomplete imports (unclosed braces)
 * followed by another import, producing invalid syntax like:
 *   import {
 *   import { Foo } from 'bar'
 *     Button,
 *     Card,
 * This function detects and fixes these patterns.
 */
function sanitizeImports(code: string): string {
  const lines = code.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect an import that opens a brace but never closes it on this line
    if (/^import\s+\{[^}]*$/.test(trimmed)) {
      // Look ahead: does the next non-empty line start with another import?
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++

      if (j < lines.length && /^import\s+/.test(lines[j].trim())) {
        // This is a broken import — the brace was never closed.
        // Skip this line entirely (the next import will be kept).
        i++
        continue
      }

      // Otherwise collect the multi-line import normally
      let importBlock = line
      i++
      while (i < lines.length) {
        importBlock += '\n' + lines[i]
        if (lines[i].includes('}')) break
        // If we hit another import statement inside the block, the block is broken
        if (/^import\s+/.test(lines[i].trim())) {
          // Broken mid-import — discard the incomplete outer import,
          // rewind to this line and let the loop handle it fresh
          importBlock = ''
          break
        }
        i++
      }
      if (importBlock) {
        result.push(importBlock)
      }
      i++
      continue
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}
