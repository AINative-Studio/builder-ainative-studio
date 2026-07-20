import { NextRequest, NextResponse } from 'next/server'
import { getPreview, isPreviewStreaming, storePreview, getSSRPreview } from '@/lib/preview-store'
import { validateJavaScriptCode } from '@/lib/code-validator'
// Sucrase removed — builds were failing. Using client-side Babel.
// The key fix is using models that produce COMPLETE code (not maverick 512-tok)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let content = getPreview(id)

  // Prefer RE-RENDERING from live code over any frozen SSR HTML. A frozen SSR
  // snapshot (from getSSRPreview) captured before a renderer fix serves the OLD
  // broken HTML forever — the #1 reason old previews stayed blank after the
  // hooks/newline/errorRecovery fixes. Only serve the frozen SSR HTML when
  // there is NO code to re-render (below and in the ZeroDB restore).
  if (!content) {
    const ssrHtml = getSSRPreview(id)
    if (ssrHtml) {
      console.log(`[Preview] No live code — serving frozen SSR HTML for ${id} (${ssrHtml.length}b)`)
      return new Response(ssrHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'SAMEORIGIN',
          'X-Preview-Source': 'ssr',
          'Cache-Control': 'public, max-age=300',
        },
      })
    }
  }

  // Not in memory — restore from ZeroDB (the durable, serverless store).
  // NOTE: the old dedicated-Postgres restore path was removed — it was
  // ECONNRESETing under load and BLOCKING before this ZeroDB fallback, which
  // showed users "Preview Expired" for generations that WERE persisted (#90/#100).
  // ZeroDB is the single source of truth per the no-dedicated-DB directive.
  if (!content) {
    try {
      const { loadGeneration } = await import('@/lib/zerodb-store')
      const gen = await loadGeneration(id)
      // Prefer RE-RENDERING from the durable generatedCode over serving a frozen
      // ssrHtml snapshot: an ssrHtml frozen before a renderer fix (e.g. the
      // hooks-on-window / newline fixes) serves the OLD broken HTML forever, so
      // old previews render blank even though the renderer is now fixed. Only
      // fall back to ssrHtml if there is no code to re-render.
      if (gen?.generatedCode) {
        content = gen.generatedCode
        storePreview(id, content) // repopulate in-memory cache
        console.log(`[Preview] Restored code from ZeroDB for ID: ${id} (re-rendering with current template)`)
      } else if (gen?.ssrHtml) {
        console.log(`[Preview] No code — serving SSR HTML from ZeroDB for ID: ${id}`)
        return new Response(gen.ssrHtml, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Frame-Options': 'SAMEORIGIN',
            'X-Preview-Source': 'ssr-zerodb',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }
    } catch (e) {
      console.warn('[Preview] ZeroDB restore failed:', e)
    }
  }

  if (!content) {
    // Return a helpful error page for expired previews
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 dark:bg-gray-900">
        <div class="min-h-screen flex items-center justify-center p-4">
          <div class="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
            <div class="mb-4">
              <svg class="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h2 class="text-2xl font-semibold text-gray-900 dark:text-white mb-2">Preview Expired</h2>
            <p class="text-gray-600 dark:text-gray-300 mb-4">
              This preview has been cleared from memory. Previews are stored temporarily and expire after 1 hour or when the server restarts.
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Chat ID: <code class="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${id}</code>
            </p>
            <div class="space-y-2">
              <button
                onclick="window.parent.location.href = '/'"
                class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Start New Chat
              </button>
              <button
                onclick="window.parent.location.reload()"
                class="w-full bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      </body>
      </html>
    `
    return new NextResponse(errorHtml, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // ====================================================================
  // STEP 1: Extract code from content (handles markdown, multi-file, raw)
  // ====================================================================

  let componentCode = ''

  // Handle multi-file output: extract the LARGEST file with a component function
  if (content.includes('// --- FILE:')) {
    const files = content.split(/\/\/\s*---\s*FILE:\s*/i)

    // Strategy: find App.tsx first, then the largest file with a function declaration
    let mainFile = files.find(f => /^src\/App\.tsx|^App\.tsx/i.test(f.trim()))

    if (!mainFile) {
      // Find the largest file that actually contains a component function
      let bestFile = ''
      let bestSize = 0
      for (const f of files) {
        const fileContent = f.replace(/^.*?---\s*\n?/, '').trim()
        if (fileContent.length > bestSize && (fileContent.includes('function ') || fileContent.includes('const ')) && fileContent.includes('return')) {
          bestFile = f
          bestSize = fileContent.length
        }
      }
      if (bestFile) mainFile = bestFile
    }

    if (!mainFile && files.length > 1) mainFile = files[1]

    if (mainFile) {
      componentCode = mainFile.replace(/^.*?---\s*\n?/, '').trim()
      console.log(`[Preview] Extracted main file from multi-file output (${componentCode.length} chars)`)
    }
  }

  // If no multi-file, try markdown code blocks
  if (!componentCode) {
    const codeBlockMatch = content.match(/```(?:tsx?|jsx?|javascript|typescript)?\s*\n([\s\S]*?)```/)
    if (codeBlockMatch) {
      componentCode = codeBlockMatch[1].trim()
    }
  }

  // If no code blocks, use raw content
  if (!componentCode) {
    componentCode = content
      .replace(/^[\s\n\r]*["'`]{1,10}(?:jsx|javascript|tsx|ts|js|react)?[\s\n\r]*/gi, '')
      .replace(/[\s\n\r]*["'`]{1,10}[\s\n\r]*$/gi, '')
      .trim()
  }

  // Must have actual code
  if (!componentCode.includes('function ') && !componentCode.includes('const ') && !componentCode.includes('return')) {
    return new NextResponse(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;text-align:center"><h2>No renderable code found</h2><p>Content length: ${content.length}</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // CRITICAL: Detect the main component name BEFORE stripping exports
  // This is the most reliable way — don't rely on scanning window later
  const exportDefaultMatch = componentCode.match(/export\s+default\s+function\s+([A-Z]\w+)/)
  const exportDefaultConstMatch = componentCode.match(/export\s+default\s+([A-Z]\w+)/)
  const standaloneFunction = componentCode.match(/^function\s+([A-Z]\w+)\s*\(/m)
  const detectedComponentName = exportDefaultMatch?.[1] || exportDefaultConstMatch?.[1] || standaloneFunction?.[1] || 'App'
  console.log(`[Preview] Detected component name: ${detectedComponentName}`)

  // CRITICAL: Clean up malformed markdown wrappers that might be in the extracted code
  // This aggressively removes any combination of quotes/backticks at start and end
  componentCode = componentCode
    // Remove ALL combinations of quotes/backticks + language identifiers at start
    .replace(/^[\s\n\r]*["'`]{1,10}(?:jsx|javascript|tsx|ts|js|react)?[\s\n\r]*/gi, '')
    // Remove ALL combinations of quotes/backticks at end
    .replace(/[\s\n\r]*["'`]{1,10}[\s\n\r]*$/gi, '')
    // Remove any remaining weird leading characters before 'function' or 'const'
    .replace(/^[^a-zA-Z/\s]+(function|const|import|export)/i, '$1')
    .trim()

  // Clean up the code — remove all import statements
  // Process line-by-line to safely handle multi-line imports like:
  //   import {
  //     Bot,
  //     Brain
  //   } from 'lucide-react'
  const codeLines = componentCode.split('\n')
  const cleanedLines: string[] = []
  let insideImport = false
  for (const line of codeLines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
      if (trimmed.includes('from ') && (trimmed.includes("'") || trimmed.includes('"'))) {
        // Single-line import — skip it entirely
        continue
      }
      // Start of multi-line import
      insideImport = true
      continue
    }
    if (insideImport) {
      if (trimmed.includes('from ') && (trimmed.includes("'") || trimmed.includes('"'))) {
        // End of multi-line import
        insideImport = false
        continue
      }
      // Still inside multi-line import — skip
      continue
    }
    cleanedLines.push(line)
  }
  componentCode = cleanedLines.join('\n')
    // Fix stray semicolons after => (common model error: .filter(x =>;)
    .replace(/=>\s*;/g, '=>')
    // Fix stray semicolons before ? in ternary (x === 'a' ; ? ...)
    .replace(/\s*;\s*\?\s/g, ' ? ')
    // Remove export statements
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+/g, '')
    // Remove TypeScript types (basic)
    .replace(/:\s*React\.FC<.*?>/g, '')
    .replace(/:\s*React\.FC/g, '')
    .replace(/:\s*any/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*number/g, '')
    .replace(/:\s*boolean/g, '')
    .replace(/interface\s+\w+\s*{[^}]*}/g, '')

  // SERVER-SIDE JSX TRUNCATION FIXER
  // If code is truncated (common with 4096 max_tokens), close all open brackets
  const openBraces = (componentCode.match(/{/g) || []).length
  const closeBraces = (componentCode.match(/}/g) || []).length
  const openParens = (componentCode.match(/\(/g) || []).length
  const closeParens = (componentCode.match(/\)/g) || []).length
  const unclosedBraces = openBraces - closeBraces
  const unclosedParens = openParens - closeParens

  if (unclosedBraces > 0 || unclosedParens > 0) {
    console.log(`[Preview] Fixing truncation: ${unclosedBraces} braces, ${unclosedParens} parens`)
    // Walk backwards to find last complete line
    const fixLines = componentCode.split('\n')
    let cutPoint = fixLines.length
    for (let i = fixLines.length - 1; i >= Math.max(0, fixLines.length - 30); i--) {
      const line = fixLines[i].trim()
      if (line.endsWith('>') || line.endsWith('/>') || line.endsWith('}') || line.endsWith(');') || line.endsWith(',')) {
        cutPoint = i + 1
        break
      }
    }
    componentCode = fixLines.slice(0, cutPoint).join('\n')
    // Recount and close
    const ob2 = (componentCode.match(/{/g) || []).length
    const cb2 = (componentCode.match(/}/g) || []).length
    const op2 = (componentCode.match(/\(/g) || []).length
    const cp2 = (componentCode.match(/\)/g) || []).length
    let closure = '\n'
    // Close JSX: need </div> for unclosed tags, then ) for return, then } for function
    for (let k = 0; k < op2 - cp2; k++) closure += ')'
    if (op2 > cp2) closure += ';\n'
    for (let k = 0; k < ob2 - cb2; k++) closure += '}\n'
    componentCode += closure
    console.log(`[Preview] Truncation fixed: added ${ob2-cb2} braces, ${op2-cp2} parens`)
  }

  // Remove duplicate component declarations (they're already loaded from /shadcn-components.js + /aikit-components.js)
  // This prevents "Identifier has already been declared" errors when injecting compiled code
  const shadcnComponents = [
    // shadcn
    'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
    'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
    'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'Separator',
    'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
    'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
    'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent', 'Progress', 'Checkbox',
    'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
    'Alert', 'AlertTitle', 'AlertDescription', 'Popover', 'PopoverTrigger', 'PopoverContent',
    // AIKit
    'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView', 'SafetyBadge',
    'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay', 'TokenUsageBar',
    'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable', 'AIKitTimeline',
    'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard', 'EmptyState',
    'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb', 'AIKitStepper',
    'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
  ];

  // Remove "Available Shadcn components" comment and everything after it
  componentCode = componentCode.replace(/\/\/\s*Available\s+Shadcn\s+components[\s\S]*/gi, '')

  // Remove individual component declarations
  shadcnComponents.forEach(comp => {
    // Remove const declarations like: const Button = ({ children }) => ...
    const constPattern = new RegExp(`const\\s+${comp}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*[\\s\\S]*?(?=\\n(?:const|function|class|let|var|$))`, 'g');
    componentCode = componentCode.replace(constPattern, '');

    // Remove function declarations like: function Button() { ... }
    const funcPattern = new RegExp(`function\\s+${comp}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'g');
    componentCode = componentCode.replace(funcPattern, '');
  });

  componentCode = componentCode.trim()

  // AX-5 ENFORCEMENT: Convert extra <h1> tags to <h2> (single h1 rule)
  let h1Idx = 0
  componentCode = componentCode.replace(/<h1([\s>])/g, (match: string, after: string) => {
    h1Idx++
    return h1Idx > 1 ? '<h2' + after : match
  })
  if (h1Idx > 1) {
    let closeIdx = 0
    componentCode = componentCode.replace(/<\/h1>/g, () => {
      closeIdx++
      return closeIdx > 1 ? '</h2>' : '</h1>'
    })
    console.log(`[Preview] AX-5: Converted ${h1Idx - 1} extra <h1> to <h2>`)
  }

  // SAFETY NET: Scan for undefined PascalCase JSX components and pre-define them as fallbacks.
  // This prevents "X is not defined" ReferenceErrors that crash the entire page.
  const knownComponents = new Set([
    // HTML elements (lowercase, won't match)
    // React
    'React', 'Fragment',
    // Shadcn
    'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
    'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
    'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'Separator',
    'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
    'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
    'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
    'Progress', 'CircularProgress', 'Checkbox', 'RadioGroup', 'RadioGroupItem',
    'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
    'Toast', 'ToastTitle', 'ToastDescription', 'Alert', 'AlertTitle', 'AlertDescription',
    'Popover', 'PopoverTrigger', 'PopoverContent',
    // AIKit
    'StreamingIndicator', 'VideoPlayer', 'CodeDisplay', 'StreamingText', 'ChatBubble',
    'MediaGallery', 'Skeleton', 'SkeletonCard', 'MetricCard', 'EmptyState',
    'AIKitSidebar', 'AIKitHeader', 'AIKitBreadcrumb', 'AIKitPagination',
    'AIKitStepper', 'AIKitTimeline', 'AIKitTable', 'AIKitRating',
    'AIKitProductCard', 'AIKitPriceCard', 'AIKitAvatar', 'AIKitBanner',
    'AgentCard', 'SwarmView', 'AgentTimeline', 'ConnectionStatus',
    'TokenUsageBar', 'SafetyBadge', 'GuardrailPanel',
    // Recharts
    'ReLineChart', 'ReBarChart', 'RePieChart', 'ResponsiveContainer',
    'XAxis', 'YAxis', 'CartesianGrid', 'RechartsTooltip', 'Legend',
    'Line', 'Bar', 'Pie', 'Cell', 'AreaChart', 'Area',
    'RadarChart', 'Radar', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
    'ComposedChart', 'RadialBarChart', 'RadialBar',
    // ErrorBoundary
    'ErrorBoundary',
  ])

  // Find all PascalCase JSX tags in the code
  const jsxTagMatches = componentCode.match(/<([A-Z][a-zA-Z0-9]+)[\s/>]/g) || []
  const jsxTags = [...new Set(jsxTagMatches.map((m: string) => m.slice(1).replace(/[\s/>]/g, '')))]
  const unknownTags = jsxTags.filter((tag: string) => !knownComponents.has(tag))

  // Store fallback definitions separately — they're plain JS, NOT JSX
  // They'll be injected into a plain <script> block, not the Babel block
  let fallbackScript = ''
  if (unknownTags.length > 0) {
    fallbackScript = unknownTags.map((tag: string) =>
      `if (typeof window.${tag} === 'undefined') { window.${tag} = function ${tag}(props) { return React.createElement('div', { className: (props && props.className) || 'p-4 rounded-xl border border-slate-200 bg-white', 'data-component': '${tag}' }, props && props.children); }; }`
    ).join('\n')
    console.log(`[Preview] Conditional fallbacks for ${unknownTags.length} unknown components: ${unknownTags.join(', ')}`)
  }

  // CRITICAL FIX: Convert template literals with interpolations to string concatenation
  // This prevents Babel from choking on ${} expressions in template literals
  // Example: className={`w-10 h-10 ${color} rounded`} -> className={`w-10 h-10 ` + color + ` rounded`}
  const templateLiteralRegex = /(className|style)=\{`([^`]*)`\}/g
  componentCode = componentCode.replace(templateLiteralRegex, (_match, attr, content) => {
    // Check if the content contains interpolations ${...}
    if (content.includes('${')) {
      // Split by ${...} expressions and convert to string concatenation
      const parts = content.split(/(\$\{[^}]+\})/)
      const convertedParts = parts.map((part: string) => {
        if (part.startsWith('${') && part.endsWith('}')) {
          // This is an interpolation like ${variable}
          return part.slice(2, -1).trim()
        } else if (part) {
          // This is a string literal part
          // Collapse multiple spaces but preserve leading/trailing spaces
          const cleaned = part.replace(/\s+/g, ' ')
          return cleaned ? `"${cleaned}"` : ''
        }
        return ''
      }).filter((p: string) => p !== '')

      // Join with + operator
      return `${attr}={${convertedParts.join(' + ')}}`
    } else {
      // No interpolation, just clean up whitespace
      const singleLine = content.replace(/\s+/g, ' ').trim()
      return `${attr}={\`${singleLine}\`}`
    }
  })

  // DISABLED: This quote-escaping logic was causing Babel syntax errors
  // by incorrectly escaping JSX attribute values like className="..."
  // The v0 API should already generate valid JSX, so this "fix" actually breaks correct code
  //
  // Previous issue: Regex matched JSX attributes and turned className="grid" into className=\"grid\"
  // which caused: Uncaught SyntaxError: Expecting Unicode escape sequence \uXXXX
  //
  // If AI-generated code has actual string literal issues, they should be fixed at the source
  // or with a proper JSX-aware parser, not naive regex replacements

  // // CRITICAL FIX: Escape unescaped quotes inside string literals
  // // This fixes AI-generated code with syntax errors like: name: 'MacBook Pro 16""'
  // // Strategy: Find string literals and escape conflicting quotes inside them

  // // Fix single-quoted strings containing unescaped double quotes or smart quotes
  // // Match: 'anything including " or " or "'
  // componentCode = componentCode.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
  //   // Inside single-quoted strings, escape any unescaped double quotes and smart quotes
  //   const inner = match.slice(1, -1) // Remove surrounding quotes
  //   const escaped = inner
  //     .replace(/(?<!\\)"/g, '\\"')     // Escape regular double quotes
  //     .replace(/"/g, '\\"')             // Escape left smart quote
  //     .replace(/"/g, '\\"')             // Escape right smart quote
  //   return `'${escaped}'`
  // })

  // // Fix double-quoted strings containing unescaped single quotes or smart quotes
  // // Match: "anything including ' or ' or '"
  // componentCode = componentCode.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
  //   // Inside double-quoted strings, escape any unescaped single quotes and smart quotes
  //   const inner = match.slice(1, -1) // Remove surrounding quotes
  //   const escaped = inner
  //     .replace(/(?<!\\)'/g, "\\'")     // Escape regular single quotes
  //     .replace(/'/g, "\\'")             // Escape left smart quote
  //     .replace(/'/g, "\\'")             // Escape right smart quote
  //   return `"${escaped}"`
  // })

  // All scripts now served locally from /vendor/ — no CDN dependency

  // Skip validation if still streaming (incomplete code)
  const streaming = isPreviewStreaming(id)
  if (!streaming) {
    // Only validate when streaming is complete
    // Imports were stripped above (globals-injection renderer), so skip the
    // #76 unresolved-component check here — every component looks unresolved
    // once imports are gone. #91.
    const validation = validateJavaScriptCode(componentCode, { importsStripped: true })
    if (!validation.valid) {
      console.error('Preview validation failed for ID:', id, 'Error:', validation.error)
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>Code Validation Error</h2>
          <p>The generated code has syntax errors and cannot be rendered safely.</p>
          <pre style="background: #fee; padding: 15px; border-radius: 4px; color: #c00;">${validation.error}</pre>
          <details>
            <summary style="cursor: pointer; margin-top: 20px;">View problematic code</summary>
            <pre style="background: #f5f5f5; padding: 15px; margin-top: 10px; overflow: auto;">${componentCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
          </details>
          <p style="margin-top: 20px;"><a href="/">← Go back and try regenerating</a></p>
        </body>
        </html>
      `
      return new NextResponse(errorHtml, {
        headers: { 'Content-Type': 'text/html' },
      })
    }
  } else {
    console.log(`Preview still streaming for ID: ${id}, skipping validation`)
  }

  // Build the component script block
  // Use type="text/babel" — Babel standalone auto-compiles these in the global scope
  // This avoids all eval/scope issues — the code runs like any normal <script>
  const safeComponentCode = componentCode.replace(/<\/script>/gi, '<\\/script>')

  // Compile JSX → JS with Babel, then inject as a <script> tag in global scope
  // This approach: Babel transform happens in script 1, compiled JS runs in script 2
  // Script 2 shares scope with the setup script (icons, React, shadcn, AIKit all available)
  const componentScriptBlock = `<script>${fallbackScript}</script>
<script>
window.__DETECTED_COMPONENT_NAME__ = "${detectedComponentName}";
(function() {
  if (typeof Babel === 'undefined' || typeof React === 'undefined') return;
  try {
    var _src = ${JSON.stringify(componentCode)};
    // errorRecovery: match the server-side validator's leniency. Without it, the
    // browser Babel is STRICTER than validateGeneratedCode (which parses with
    // errorRecovery) — so code the validator PASSED (e.g. an array-literal const
    // missing a trailing semicolon) throws "Missing semicolon" here and renders
    // blank. errorRecovery recovers from these and compiles the app anyway.
    var _compiled = Babel.transform(_src, {presets:[['react', {runtime:'classic'}]], parserOpts:{errorRecovery:true}}).code;
    // Strip any remaining import/export statements that would crash in a script tag
    _compiled = _compiled.replace(/^import\\s+.*$/gm, '').replace(/^export\\s+(default\\s+)?/gm, '');
    // Inject compiled JS as a new script tag — runs in GLOBAL scope
    var _s = document.createElement('script');
    _s.textContent = _compiled + ';\\nif(typeof ${detectedComponentName}!=="undefined")window.${detectedComponentName}=${detectedComponentName};';
    document.body.appendChild(_s);
    console.log('[Preview] ✓ Compiled and injected: ${detectedComponentName}, exists:', typeof window['${detectedComponentName}']);
    document.getElementById('loading-indicator').style.display = 'none';
  } catch(e) {
    console.error('[Preview] Babel error:', e.message);
    window.__BABEL_FAILED__ = true;
    document.getElementById('loading-indicator').innerHTML = '<div style="text-align:center;padding:40px"><h3 style="color:#dc2626">Syntax Error</h3><pre style="background:#fef2f2;padding:16px;border-radius:8px;max-width:600px;margin:12px auto;overflow:auto;font-size:12px;color:#991b1b;text-align:left">' + String(e.message||e).replace(/</g,'&lt;').substring(0,500) + '</pre></div>';
  }
})();
</script>`

  // Create simple HTML with the component
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
    <!-- Google Fonts: Inter (primary) + Geist-like fallback -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <!-- Core: React 18 -->
    <!-- React 18 from CDN -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/lucide@0.344.0/dist/umd/lucide.min.js"></script>
    <script crossorigin src="https://unpkg.com/prop-types@15/prop-types.min.js"></script>
    <script src="https://unpkg.com/recharts@2.15.0/umd/Recharts.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ['Inter', 'Poppins', 'system-ui', 'sans-serif'],
            },
            colors: {
              'brand-primary': '#5867EF',
              'dark-1': '#131726',
              'dark-2': '#22263c',
              'dark-3': '#31395a',
            },
            boxShadow: {
              'ds-sm': '0 2px 4px rgba(19, 23, 38, 0.1), 0 1px 2px rgba(19, 23, 38, 0.06)',
              'ds-md': '0 4px 8px rgba(19, 23, 38, 0.12), 0 2px 4px rgba(19, 23, 38, 0.08)',
              'ds-lg': '0 12px 24px rgba(19, 23, 38, 0.15), 0 4px 8px rgba(19, 23, 38, 0.1)',
            },
            keyframes: {
              'fade-in': { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
              'slide-in': { from: { opacity: '0', transform: 'translateX(-10px)' }, to: { opacity: '1', transform: 'translateX(0)' } },
              'float': { '0%, 100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-10px)' } },
            },
            animation: {
              'fade-in': 'fade-in 0.5s ease-out',
              'slide-in': 'slide-in 0.4s ease-out',
              'float': 'float 3s ease-in-out infinite',
            },
          },
        },
      }
    </script>
    <script src="/shadcn-components.js"></script>
    <script src="/aikit-components.js"></script>
    <style>
      body { margin: 0; font-family: 'Inter', 'Poppins', system-ui, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
      *, *::before, *::after { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      h1, h2, h3, h4, h5, h6 { text-wrap: balance; }
      p { text-wrap: pretty; }
      /* Loading spinner shown until React renders */
      #loading-indicator {
        position: fixed; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; background: #f8fafc; z-index: 9999;
      }
      #loading-indicator .spinner {
        width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #3b82f6;
        border-radius: 50%; animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      #loading-indicator p { margin-top: 16px; color: #64748b; font-size: 14px; }
    </style>
    <script>
      // Timeout: if React doesn't render within 15s, show error
      setTimeout(function() {
        var root = document.getElementById('root');
        var loader = document.getElementById('loading-indicator');
        if (root && (!root.innerHTML || root.innerHTML.trim() === '') && loader) {
          loader.innerHTML = '<div style="text-align:center;padding:40px;"><h3 style="color:#1e293b;font-size:18px;">Preview Loading Slowly</h3><p style="color:#64748b;margin:8px 0;">CDN scripts are still loading. Try refreshing.</p><button onclick="location.reload()" style="background:#3b82f6;color:white;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;margin-top:12px;">Refresh</button></div>';
        }
      }, 15000);
    </script>
</head>
<body>
    <div id="loading-indicator"><div class="spinner"></div><p>Loading preview...</p></div>
    <div id="root"></div>
    <!-- Setup script: icons, hooks, libraries (plain JS, no Babel needed) -->
    <script>
      console.log('[Preview] Starting preview initialization...');

      // AX-5 ENFORCEMENT: Intercept React.createElement to ensure single h1
      // This works WITH React instead of fighting it
      const _originalCreateElement = React.createElement;
      let _h1Count = 0;
      // A bare component OBJECT (forwardRef/memo/lazy — shape { $$typeof, render })
      // placed in a CHILD position, e.g. {SomeIcon} or {chart} instead of
      // <SomeIcon/>, makes React throw the fatal "Objects are not valid as a
      // React child (found: object with keys {$$typeof, render})" crash overlay,
      // killing the whole preview. This happens for Recharts/forwardRef refs the
      // model references as values. Detect such a child and render it as an
      // element (if it's a component) or drop it — turning a hard crash into a
      // graceful, mostly-correct render.
      function _sanitizeChild(c) {
        if (c && typeof c === 'object' && c.$$typeof && c.type === undefined) {
          // It's a component definition object, not a React element. If it's
          // renderable (forwardRef/memo/function), mount it; else drop it.
          try {
            if (typeof c === 'function' || typeof c.render === 'function' || c.$$typeof) {
              return _originalCreateElement(c, null);
            }
          } catch (e) {}
          return null;
        }
        return c;
      }
      function _sanitizeChildren(v) {
        return Array.isArray(v) ? v.map(_sanitizeChild) : _sanitizeChild(v);
      }
      React.createElement = function(type) {
        var args = Array.prototype.slice.call(arguments);
        if (type === 'h1') {
          _h1Count++;
          if (_h1Count > 1) args[0] = 'h2'; // Convert extra h1 to h2
        }
        // Sanitize positional children (args[2..]) so a stray component object
        // can't crash the whole preview with "Objects are not valid as a React
        // child". Handles <div>{Icon}</div> and {list.map(...)} cases.
        if (args.length > 2) {
          for (var _i = 2; _i < args.length; _i++) args[_i] = _sanitizeChildren(args[_i]);
        }
        // Also sanitize a children PROP (arg[1].children) — components that
        // receive a component-object via the children prop rather than a
        // positional arg (e.g. AIKit stubs that spread props).
        if (args[1] && typeof args[1] === 'object' && 'children' in args[1]) {
          try { args[1] = Object.assign({}, args[1], { children: _sanitizeChildren(args[1].children) }); } catch (e) {}
        }
        return _originalCreateElement.apply(React, args);
      };

      // Make React hooks available. CRITICAL: the compiled App runs in a
      // SEPARATE global-scope <script>, so these must be on window — a plain
      // const here is script-scoped and the App would throw "useState is not
      // defined" and render blank (the #1 cause of blank previews).
      const { useState, useEffect, useCallback, useMemo, useRef, useContext, createContext, Fragment } = React;
      window.useState = useState; window.useEffect = useEffect;
      window.useCallback = useCallback; window.useMemo = useMemo;
      window.useRef = useRef; window.useContext = useContext;
      window.createContext = createContext; window.Fragment = Fragment;
      // Also expose the less-common hooks apps sometimes use.
      window.useReducer = React.useReducer; window.useLayoutEffect = React.useLayoutEffect;
      window.useId = React.useId; window.useTransition = React.useTransition;
      window.useDeferredValue = React.useDeferredValue; window.useImperativeHandle = React.useImperativeHandle;
      console.log('[Preview] React hooks loaded + exposed on window:', { useState: !!window.useState, useEffect: !!window.useEffect });

      // Create React components from Lucide vanilla SVG icon definitions
      // lucide (vanilla) exports icons as ["svg", {svgAttrs}, [[tag, attrs], ...]]
      const _lucideIcons = window.lucide || {};
      function _createLucideIcon(name) {
        const iconData = _lucideIcons[name];
        if (!iconData || !Array.isArray(iconData)) return function FallbackIcon(props) {
          return React.createElement('span', { className: props.className || '', style: props.style }, '');
        };
        // iconData[0] = "svg", iconData[1] = svg attrs, iconData[2] = children array
        const children = iconData[2] || [];
        return function LucideIcon({ className = 'w-4 h-4', size, color, strokeWidth, fill, style, ...rest }) {
          const s = size || undefined;
          return React.createElement('svg', {
            xmlns: 'http://www.w3.org/2000/svg',
            width: s || 24,
            height: s || 24,
            viewBox: '0 0 24 24',
            fill: fill || 'none',
            stroke: color || 'currentColor',
            strokeWidth: strokeWidth || 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className: className,
            style: style,
            ...rest
          }, ...children.map(function(child, i) {
            // child is [tagName, attributes]
            var tag = child[0];
            var attrs = Object.assign({}, child[1] || {}, { key: i });
            // Convert hyphenated attrs to camelCase for React
            if (attrs['stroke-width']) { attrs.strokeWidth = attrs['stroke-width']; delete attrs['stroke-width']; }
            if (attrs['stroke-linecap']) { attrs.strokeLinecap = attrs['stroke-linecap']; delete attrs['stroke-linecap']; }
            if (attrs['stroke-linejoin']) { attrs.strokeLinejoin = attrs['stroke-linejoin']; delete attrs['stroke-linejoin']; }
            if (attrs['fill-rule']) { attrs.fillRule = attrs['fill-rule']; delete attrs['fill-rule']; }
            if (attrs['clip-rule']) { attrs.clipRule = attrs['clip-rule']; delete attrs['clip-rule']; }
            return React.createElement(tag, attrs);
          }));
        };
      }

      // Create all icon components
      const _iconNames = Object.keys(_lucideIcons);
      const _iconComponents = {};
      _iconNames.forEach(function(name) {
        _iconComponents[name] = _createLucideIcon(name);
      });

      // Safe icon accessor — returns fallback circle for unknown icons
      // All returned functions are tagged with _isLucideIcon for detection
      function _getIcon(name) {
        if (_iconComponents[name]) {
          _iconComponents[name]._isLucideIcon = true;
          return _iconComponents[name];
        }
        var fallback = function UnknownIcon(props) {
          var cn = (props && props.className) || 'w-4 h-4';
          var sz = (props && props.size) || 24;
          var clr = (props && props.color) || 'currentColor';
          return React.createElement('svg', {
            xmlns: 'http://www.w3.org/2000/svg', width: sz, height: sz,
            viewBox: '0 0 24 24', fill: 'none', stroke: clr, strokeWidth: 2,
            strokeLinecap: 'round', strokeLinejoin: 'round', className: cn
          }, React.createElement('circle', { cx: '12', cy: '12', r: '10' }));
        };
        fallback._isLucideIcon = true;
        return fallback;
      }

      // Create all common icon constants using safe accessor
      const Search = _getIcon("Search");
      const Menu = _getIcon("Menu");
      const X = _getIcon("X");
      const ChevronDown = _getIcon("ChevronDown");
      const ChevronRight = _getIcon("ChevronRight");
      const ChevronLeft = _getIcon("ChevronLeft");
      const ChevronUp = _getIcon("ChevronUp");
      const Home = _getIcon("Home");
      const Settings = _getIcon("Settings");
      const Users = _getIcon("Users");
      const BarChart3 = _getIcon("BarChart3");
      const FileText = _getIcon("FileText");
      const Bell = _getIcon("Bell");
      const Mail = _getIcon("Mail");
      const Star = _getIcon("Star");
      const Heart = _getIcon("Heart");
      const ShoppingCart = _getIcon("ShoppingCart");
      const Plus = _getIcon("Plus");
      const Minus = _getIcon("Minus");
      const Edit = _getIcon("Pencil");
      const Edit2 = _getIcon("Pencil");
      const Pencil = _getIcon("Pencil");
      const Trash2 = _getIcon("Trash2");
      const Eye = _getIcon("Eye");
      const EyeOff = _getIcon("EyeOff");
      const Check = _getIcon("Check");
      const AlertCircle = _getIcon("AlertCircle");
      const Info = _getIcon("Info");
      const HelpCircle = _getIcon("HelpCircle");
      const ArrowRight = _getIcon("ArrowRight");
      const ArrowLeft = _getIcon("ArrowLeft");
      const ArrowUp = _getIcon("ArrowUp");
      const ArrowDown = _getIcon("ArrowDown");
      const ExternalLink = _getIcon("ExternalLink");
      const Download = _getIcon("Download");
      const Upload = _getIcon("Upload");
      const Share2 = _getIcon("Share2");
      const Filter = _getIcon("Filter");
      const Calendar = _getIcon("Calendar");
      const Clock = _getIcon("Clock");
      const MapPin = _getIcon("MapPin");
      const Phone = _getIcon("Phone");
      const Globe = _getIcon("Globe");
      const Lock = _getIcon("Lock");
      const Unlock = _getIcon("Unlock");
      const Shield = _getIcon("Shield");
      const Zap = _getIcon("Zap");
      const TrendingUp = _getIcon("TrendingUp");
      const TrendingDown = _getIcon("TrendingDown");
      const Activity = _getIcon("Activity");
      const DollarSign = _getIcon("DollarSign");
      const CreditCard = _getIcon("CreditCard");
      const Package = _getIcon("Package");
      const Truck = _getIcon("Truck");
      const Gift = _getIcon("Gift");
      const Sun = _getIcon("Sun");
      const Moon = _getIcon("Moon");
      const Laptop = _getIcon("Laptop");
      const Smartphone = _getIcon("Smartphone");
      const Code = _getIcon("Code");
      const Terminal = _getIcon("Terminal");
      const GitBranch = _getIcon("GitBranch");
      const Send = _getIcon("Send");
      const MessageSquare = _getIcon("MessageSquare");
      const MessageCircle = _getIcon("MessageCircle");
      const Bookmark = _getIcon("Bookmark");
      const Tag = _getIcon("Tag");
      const Copy = _getIcon("Copy");
      const Save = _getIcon("Save");
      const RefreshCw = _getIcon("RefreshCw");
      const MoreHorizontal = _getIcon("MoreHorizontal");
      const MoreVertical = _getIcon("MoreVertical");
      const Layers = _getIcon("Layers");
      const Layout = _getIcon("Layout");
      const Grid = _getIcon("Grid3x3");
      const List = _getIcon("List");
      const PieChart = _getIcon("PieChart");
      const LineChart = _getIcon("LineChart");
      const BarChart = _getIcon("BarChart");
      const Target = _getIcon("Target");
      const Award = _getIcon("Award");
      const Sparkles = _getIcon("Sparkles");
      const Rocket = _getIcon("Rocket");
      const Building2 = _getIcon("Building2");
      const Briefcase = _getIcon("Briefcase");
      const BookOpen = _getIcon("BookOpen");
      const Bot = _getIcon("Bot");
      const Brain = _getIcon("Brain");
      const LogOut = _getIcon("LogOut");
      const LogIn = _getIcon("LogIn");
      const UserPlus = _getIcon("UserPlus");
      const Users2 = _getIcon("Users2");
      const FolderOpen = _getIcon("FolderOpen");
      const File = _getIcon("File");
      const Box = _getIcon("Box");
      const Inbox = _getIcon("Inbox");
      const CircleDot = _getIcon("CircleDot");
      const Wand2 = _getIcon("Wand2");
      const Palette = _getIcon("Palette");
      const Lightbulb = _getIcon("Lightbulb");
      const Newspaper = _getIcon("Newspaper");
      const GraduationCap = _getIcon("GraduationCap");
      const Hexagon = _getIcon("Hexagon");
      const Maximize = _getIcon("Maximize");
      const Minimize = _getIcon("Minimize");
      const Maximize2 = _getIcon("Maximize2");
      const Minimize2 = _getIcon("Minimize2");
      // Additional commonly-used icons
      const Play = _getIcon("Play");
      const Pause = _getIcon("Pause");
      const SkipForward = _getIcon("SkipForward");
      const SkipBack = _getIcon("SkipBack");
      const Volume2 = _getIcon("Volume2");
      const VolumeX = _getIcon("VolumeX");
      const Mic = _getIcon("Mic");
      const MicOff = _getIcon("MicOff");
      const Camera = _getIcon("Camera");
      const Video = _getIcon("Video");
      const Image = _getIcon("Image");
      const Music = _getIcon("Music");
      const Wifi = _getIcon("Wifi");
      const Cloud = _getIcon("Cloud");
      const Database = _getIcon("Database");
      const Server = _getIcon("Server");
      const HardDrive = _getIcon("HardDrive");
      const Monitor = _getIcon("Monitor");
      const Cpu = _getIcon("Cpu");
      const Github = _getIcon("Github");
      const Twitter = _getIcon("Twitter");
      const Linkedin = _getIcon("Linkedin");
      const Facebook = _getIcon("Facebook");
      const Instagram = _getIcon("Instagram");
      const Youtube = _getIcon("Youtube");
      const Hash = _getIcon("Hash");
      const AtSign = _getIcon("AtSign");
      const Paperclip = _getIcon("Paperclip");
      const Link = _getIcon("Link");
      const Clipboard = _getIcon("Clipboard");
      const Printer = _getIcon("Printer");
      const RotateCcw = _getIcon("RotateCcw");
      const Move = _getIcon("Move");
      const Grip = _getIcon("Grip");
      const Table2 = _getIcon("Table2");
      const Trophy = _getIcon("Trophy");
      const Flag = _getIcon("Flag");
      const Flame = _getIcon("Flame");
      const Brush = _getIcon("Brush");
      const Pen = _getIcon("Pen");
      const Network = _getIcon("Network");
      const Workflow = _getIcon("Workflow");
      const Route = _getIcon("Route");
      const Compass = _getIcon("Compass");
      const Navigation = _getIcon("Navigation");
      const UserMinus = _getIcon("UserMinus");
      const UserCheck = _getIcon("UserCheck");
      const FolderClosed = _getIcon("FolderClosed");
      const FilePlus = _getIcon("FilePlus");
      const FileCheck = _getIcon("FileCheck");
      const FileX = _getIcon("FileX");
      const Boxes = _getIcon("Boxes");
      const Archive = _getIcon("Archive");
      const Circle = _getIcon("Circle");
      const Square = _getIcon("Square");
      const Triangle = _getIcon("Triangle");
      const Octagon = _getIcon("Octagon");
      const Pentagon = _getIcon("Pentagon");
      const Crosshair = _getIcon("Crosshair");
      const MousePointer = _getIcon("MousePointer");
      const Fingerprint = _getIcon("Fingerprint");
      const QrCode = _getIcon("QrCode");
      const ScanLine = _getIcon("ScanLine");
      const CircuitBoard = _getIcon("CircuitBoard");
      const Headphones = _getIcon("Headphones");
      const AlertTriangle = _getIcon("AlertTriangle");
      const CheckCircle = _getIcon("CheckCircle");
      const CheckCircle2 = _getIcon("CheckCircle2");
      const XCircle = _getIcon("XCircle");
      const MinusCircle = _getIcon("MinusCircle");
      const PlusCircle = _getIcon("PlusCircle");
      const ArrowUpRight = _getIcon("ArrowUpRight");
      const ArrowDownRight = _getIcon("ArrowDownRight");
      const ChevronFirst = _getIcon("ChevronFirst");
      const ChevronLast = _getIcon("ChevronLast");
      const Repeat = _getIcon("Repeat");
      const Shuffle = _getIcon("Shuffle");
      const SlidersHorizontal = _getIcon("SlidersHorizontal");
      const Cog = _getIcon("Settings"); // alias
      const Gear = _getIcon("Settings"); // alias

      // Make ALL lucide icons available as window globals so any icon name works in JSX.
      // The component detector's _isIconWrapper check prevents these from being picked as page components.
      _iconNames.forEach(function(name) {
        var icon = _getIcon(name);
        if (!window[name]) window[name] = icon;
      });

      console.log('[Preview] Lucide icons loaded:', _iconNames.length, 'icons available on window');

      // Make Recharts available globally
      const recharts = window.Recharts || {};
      const {
        LineChart: ReLineChart, Line, BarChart: ReBarChart, Bar,
        PieChart: RePieChart, Pie, Cell, AreaChart, Area,
        RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
        ComposedChart, Scatter, ScatterChart,
        XAxis, YAxis, CartesianGrid, Tooltip: RechartsTooltip,
        Legend, ResponsiveContainer, RadialBarChart, RadialBar,
        Treemap, Funnel, FunnelChart
      } = recharts;
      // CRITICAL: the compiled app runs in a SEPARATE global-scope <script>, so
      // these block-scoped consts are invisible to it — using <RePieChart>,
      // <Pie>, <ResponsiveContainer> etc. would throw "Element type is invalid:
      // ...got undefined". Expose every Recharts component on window so the app
      // script can resolve them. Do NOT clobber the lucide icon names already on
      // window (PieChart/LineChart/BarChart are icons); only add the Re* aliases
      // and the recharts-only names.
      var _rechartsGlobals = {
        ReLineChart: ReLineChart, ReBarChart: ReBarChart, RePieChart: RePieChart,
        Line: Line, Bar: Bar, Pie: Pie, Cell: Cell, Area: Area, AreaChart: AreaChart,
        RadarChart: RadarChart, Radar: Radar, PolarGrid: PolarGrid,
        PolarAngleAxis: PolarAngleAxis, PolarRadiusAxis: PolarRadiusAxis,
        ComposedChart: ComposedChart, Scatter: Scatter, ScatterChart: ScatterChart,
        XAxis: XAxis, YAxis: YAxis, CartesianGrid: CartesianGrid,
        RechartsTooltip: RechartsTooltip, Legend: Legend,
        ResponsiveContainer: ResponsiveContainer, RadialBarChart: RadialBarChart,
        RadialBar: RadialBar, Treemap: Treemap, Funnel: Funnel, FunnelChart: FunnelChart
      };
      Object.keys(_rechartsGlobals).forEach(function(k) {
        if (_rechartsGlobals[k] && !window[k]) window[k] = _rechartsGlobals[k];
      });
      // Tooltip is commonly imported bare from recharts; only set it if a lucide
      // icon named Tooltip isn't already occupying the slot.
      if (RechartsTooltip && !window.Tooltip) window.Tooltip = RechartsTooltip;
      console.log('[Preview] Recharts loaded:', !!recharts.LineChart, '| exposed on window:', Object.keys(_rechartsGlobals).filter(function(k){return !!window[k]}).length);

      // Make AIKit / AINative Primitive components available
      const aikit = window.AIKitComponents || {};
      const {
        StreamingIndicator, VideoPlayer, CodeDisplay, StreamingText,
        ChatBubble, MediaGallery, Skeleton, SkeletonCard,
        MetricCard, EmptyState,
        AIKitSidebar, AIKitHeader, AIKitBreadcrumb, AIKitPagination,
        AIKitStepper, AIKitTimeline, AIKitTable, AIKitRating,
        AIKitProductCard, AIKitPriceCard, AIKitAvatar, AIKitBanner,
        AgentCard, SwarmView, AgentTimeline, ConnectionStatus,
        TokenUsageBar, SafetyBadge, GuardrailPanel
      } = aikit;
      console.log('[Preview] AIKit loaded:', Object.keys(aikit).length, 'components');

      // Make shadcn components available
      const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
              Input, Label, Badge, Avatar, AvatarImage, AvatarFallback, Table, TableHeader,
              TableBody, TableRow, TableHead, TableCell, Separator,
              Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
              Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
              Tabs, TabsList, TabsTrigger, TabsContent,
              Progress, CircularProgress, Checkbox, RadioGroup, RadioGroupItem,
              Accordion, AccordionItem, AccordionTrigger, AccordionContent,
              Toast, ToastTitle, ToastDescription,
              Alert, AlertTitle, AlertDescription,
              Popover, PopoverTrigger, PopoverContent,
              cn } = window.ShadcnComponents || {};

      // Check all shadcn components
      const allComponents = {
        Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
        Input, Label, Badge, Avatar, AvatarImage, AvatarFallback, Table, TableHeader,
        TableBody, TableRow, TableHead, TableCell, Separator,
        Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
        Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
        Tabs, TabsList, TabsTrigger, TabsContent,
        Progress, CircularProgress, Checkbox, RadioGroup, RadioGroupItem,
        Accordion, AccordionItem, AccordionTrigger, AccordionContent,
        Toast, ToastTitle, ToastDescription,
        Alert, AlertTitle, AlertDescription,
        Popover, PopoverTrigger, PopoverContent,
        cn
      };

      const missingComponents = Object.entries(allComponents)
        .filter(([name, comp]) => !comp)
        .map(([name]) => name);

      console.log('[Preview] Shadcn components loaded:', {
        Button: !!Button,
        Card: !!Card,
        Input: !!Input,
        Tabs: !!Tabs,
        TabsList: !!TabsList,
        TabsTrigger: !!TabsTrigger,
        TabsContent: !!TabsContent,
        Separator: !!Separator,
        cn: !!cn
      });

      if (missingComponents.length > 0) {
        console.error('[Preview] ✗ Missing shadcn components:', missingComponents);
      }

      // Sample data for components
      const products = [
        { id: 1, name: 'Product 1', price: 29.99, image: 'https://via.placeholder.com/200' },
        { id: 2, name: 'Product 2', price: 39.99, image: 'https://via.placeholder.com/200' }
      ];

      // Create an error boundary to catch React rendering errors
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null, errorInfo: null };
        }

        static getDerivedStateFromError(error) {
          return { hasError: true };
        }

        componentDidCatch(error, errorInfo) {
          console.error('[Preview] React Error Boundary caught error:', error);
          console.error('[Preview] Error info:', errorInfo);
          this.setState({ error, errorInfo });
        }

        render() {
          if (this.state.hasError) {
            // Graceful fallback — never dump a raw red React error at the user.
            // A runtime render crash (e.g. a component object used as a child)
            // shows a clean "refining" card instead of the scary stack. The raw
            // error is kept in a collapsed <details> for debugging only.
            return React.createElement('div', {
              style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px' }
            }, React.createElement('div', {
              style: { maxWidth: '440px', textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '40px 32px', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }
            }, [
              React.createElement('div', { key: 'icon', style: { fontSize: '40px', marginBottom: '12px' } }, '🛠️'),
              React.createElement('h1', { key: 'title', style: { fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' } }, 'Refining your app'),
              React.createElement('p', { key: 'body', style: { fontSize: '14px', color: '#475569', lineHeight: 1.6, margin: '0 0 16px' } }, 'AINative built a first version but it needs another pass to render cleanly. Try regenerating — the next attempt usually gets it.'),
              React.createElement('details', { key: 'details', style: { textAlign: 'left', marginTop: '8px' } }, [
                React.createElement('summary', { key: 'summary', style: { fontSize: '12px', color: '#94a3b8', cursor: 'pointer' } }, 'Technical details'),
                React.createElement('pre', { key: 'stack', style: { fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '10px', borderRadius: '8px', overflow: 'auto', marginTop: '8px' } },
                  (this.state.error?.toString() || 'Unknown error') + '\\n\\n' + (this.state.errorInfo?.componentStack || '')
                )
              ])
            ]));
          }
          return this.props.children;
        }
      }
      // The component-render script runs in a SEPARATE script tag (global
      // scope) and references ErrorBoundary as a bare identifier — but a class
      // declaration is script-scoped, not a global. Expose it on window so the
      // renderer can wrap the app in it (fixes "ErrorBoundary is not defined").
      window.ErrorBoundary = ErrorBoundary;

    </script>
    ${componentScriptBlock}
    <!-- Component detection and rendering — wait for Babel to process text/babel scripts -->
    <script>
      // Skip component detection if Babel compilation failed
      if (window.__BABEL_FAILED__) {
        console.log('[Preview] Skipping component detection — Babel failed');
      } else {
      try {

        // Find the main page component to render.
        // Strategy: Check known component name patterns FIRST (most reliable),
        // then fall back to scanning window for anything that looks like a page component.
        let Component = null;

        // Step 1: Try to find component by eval in local scope (Babel scope)
        // These are the most common names Claude generates for page components
        // Page component names to try (NO single-word names that could be Lucide icons!)
        const _pageNames = [
          // Landing pages
          'LandingPage', 'TaskFlowLanding', 'InkFlowLanding', 'ReviewBotLanding',
          'ReviewBotLandingPage', 'CodeLensLanding', 'DevPulseLanding',
          // Dashboards
          'Dashboard', 'ProjectDashboard', 'SalesDashboard', 'AgentOpsDashboard',
          'AdminDashboard', 'AnalyticsDashboard', 'MetricsDashboard',
          'AgentMonitoringDashboard', 'SocialMediaDashboard',
          // Panels
          'AdminPanel', 'ControlPanel',
          // E-commerce
          'EcommercePage', 'EcommerceApp', 'EcommerceSite', 'StorePage',
          'SneakerStore', 'SneakerShop', 'SneakerStorePage',
          'ShoppingApp', 'CartPage', 'ProductListingPage', 'ProductListPage',
          // Content
          'BlogPage', 'BlogLayout',
          // Marketplace / Hub / Docs
          'MarketplacePage', 'AgentHubMarketplace', 'AgentHub',
          'DocsPage', 'DocumentationPage', 'ApiDocsPage',
          'GateForgeDocs', 'GateForgeApp',
          // Apps
          'HomePage', 'MainApp', 'PageLayout',
          'TodoList', 'TodoApp', 'ChatApp', 'ChatInterface',
          // Generic (last resort, icon check will filter)
          'App', 'Main', 'Component', 'Page',
        ];

        // Suffixes that indicate a page-level component
        const _componentSuffixes = ['Page', 'App', 'Dashboard', 'Panel', 'Landing', 'Site', 'View', 'Store', 'Shop', 'Marketplace', 'Hub', 'Docs', 'Portal', 'Interface', 'Platform'];

        console.log('[Preview] Searching for page component...');

        // Check if a function was created by _getIcon (our Lucide wrapper)
        function _isIconWrapper(fn) {
          if (!fn) return false;
          if (fn._isLucideIcon) return true;
          var str = fn.toString();
          return str.length < 600 && (str.includes('viewBox') || str.includes('UnknownIcon') || str.includes('LucideIcon') || str.includes('0 0 24 24'));
        }

        // PRIORITY 1: Use the server-detected component name (most reliable)
        var _detectedName = window.__DETECTED_COMPONENT_NAME__;
        if (_detectedName) {
          try {
            var _detected = new Function('return typeof ' + _detectedName + ' !== "undefined" ? ' + _detectedName + ' : undefined')();
            if (typeof _detected === 'function' && !_isIconWrapper(_detected)) {
              Component = _detected;
              console.log('[Preview] ✓ Found component via server detection: ' + _detectedName);
            }
          } catch(e) {}
        }

        // PRIORITY 2: Build a safe component registry for known names
        if (!Component) {
          var _localComponents = {};
          _pageNames.forEach(function(n) {
            try { _localComponents[n] = new Function('return typeof ' + n + ' !== "undefined" ? ' + n + ' : undefined')(); } catch(e) {}
          });

          for (const name of _pageNames) {
            try {
              const fn = _localComponents[name];
              if (typeof fn === 'function' && !_isIconWrapper(fn)) {
                Component = fn;
                console.log('[Preview] ✓ Found component: ' + name + ' (local scope)');
                break;
              }
            } catch (e) {}
          }
        }

        // If not found, search window for names ending with page-like suffixes
        if (!Component) {
          for (const key in window) {
            if (typeof window[key] === 'function' && /^[A-Z]/.test(key)) {
              // Check if name ends with a page suffix
              const matchesSuffix = _componentSuffixes.some(function(s) { return key.endsWith(s); });
              // Also skip known AIKit component names
              const _aikitNames = ['SwarmView', 'AgentCard', 'AgentTimeline', 'ConnectionStatus', 'TokenUsageBar', 'SafetyBadge', 'GuardrailPanel', 'AIKitSidebar', 'AIKitHeader', 'AIKitTable', 'AIKitBreadcrumb', 'AIKitPagination', 'AIKitStepper', 'AIKitTimeline', 'AIKitRating', 'AIKitProductCard', 'AIKitPriceCard', 'AIKitAvatar', 'AIKitBanner', 'MetricCard', 'MediaGallery', 'Skeleton', 'SkeletonCard', 'EmptyState', 'StreamingIndicator', 'VideoPlayer', 'CodeDisplay', 'StreamingText', 'ChatBubble'];
              if (matchesSuffix && key !== 'React' && key !== 'ReactDOM' && !_isIconWrapper(window[key]) && !_aikitNames.includes(key)) {
                Component = window[key];
                console.log('[Preview] ✓ Found component: ' + key + ' (window, suffix match)');
                break;
              }
            }
          }
        }

        // Last resort: find any window function that's NOT a known library component
        if (!Component) {
          // Build a comprehensive set of names to skip
          const _skipNames = new Set([
            'React', 'ReactDOM', 'Babel', 'ErrorBoundary', 'ShadcnComponents',
            'UnknownIcon', 'LucideIcon', 'FallbackIcon',
            // All shadcn component names
            'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
            'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback',
            'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
            'Separator', 'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader',
            'DialogTitle', 'DialogDescription', 'DialogFooter', 'Select', 'SelectTrigger',
            'SelectValue', 'SelectContent', 'SelectItem', 'Tabs', 'TabsList', 'TabsTrigger',
            'TabsContent', 'Progress', 'CircularProgress', 'Checkbox', 'RadioGroup',
            'RadioGroupItem', 'Accordion', 'AccordionItem', 'AccordionTrigger',
            'AccordionContent', 'Toast', 'ToastTitle', 'ToastDescription',
            'Alert', 'AlertTitle', 'AlertDescription', 'Popover', 'PopoverTrigger', 'PopoverContent',
            ..._iconNames,
          // AIKit / AINative Primitive components
          'StreamingIndicator', 'VideoPlayer', 'CodeDisplay', 'StreamingText',
          'ChatBubble', 'MediaGallery', 'Skeleton', 'SkeletonCard', 'MetricCard', 'EmptyState',
          'AIKitSidebar', 'AIKitHeader', 'AIKitBreadcrumb', 'AIKitPagination',
          'AIKitStepper', 'AIKitTimeline', 'AIKitTable', 'AIKitRating',
          'AIKitProductCard', 'AIKitPriceCard', 'AIKitAvatar', 'AIKitBanner',
          'AgentCard', 'SwarmView', 'AgentTimeline', 'ConnectionStatus',
          'TokenUsageBar', 'SafetyBadge', 'GuardrailPanel',
          // Recharts
          'ReLineChart', 'ReBarChart', 'RePieChart', 'ResponsiveContainer',
          'XAxis', 'YAxis', 'CartesianGrid', 'RechartsTooltip', 'Legend',
          'Line', 'Bar', 'Pie', 'Cell', 'AreaChart', 'Area',
          'RadarChart', 'Radar', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
          'ComposedChart', 'Scatter', 'ScatterChart', 'RadialBarChart', 'RadialBar',
          'Treemap', 'Funnel', 'FunnelChart',
          ]);
          // Also skip single-word names under 8 chars (likely icons or utils)
          for (const key in window) {
            if (typeof window[key] === 'function' && /^[A-Z]/.test(key) && !_skipNames.has(key)) {
              // Prefer names with 2+ words or longer than 8 chars (page components)
              if ((key.length > 8 || /[a-z][A-Z]/.test(key)) && !_isIconWrapper(window[key])) {
                Component = window[key];
                console.log('[Preview] ✓ Found component: ' + key + ' (window, last resort)');
                break;
              }
            }
          }
        }

        if (Component) {
          console.log('[Preview] Component found, attempting to render...', Component.name || 'Anonymous');
          const rootElement = document.getElementById('root');
          console.log('[Preview] Root element:', rootElement);

          const root = ReactDOM.createRoot(rootElement);
          console.log('[Preview] React root created:', root);

          // Wrap component in ErrorBoundary to catch rendering errors. Resolve
          // it from window (set in the setup script) with a passthrough fallback
          // so a scope miss degrades to rendering the app un-wrapped instead of
          // crashing with "ErrorBoundary is not defined".
          const _EB = (typeof window !== 'undefined' && window.ErrorBoundary)
            ? window.ErrorBoundary
            : (typeof ErrorBoundary !== 'undefined' ? ErrorBoundary : (function(p){ return p.children; }));
          const wrappedElement = React.createElement(_EB, null,
            React.createElement(Component)
          );
          console.log('[Preview] React element created (wrapped in ErrorBoundary)');

          root.render(wrappedElement);
          console.log('[Preview] ✓ Render called successfully!');
          // Hide loading indicator
          var loader = document.getElementById('loading-indicator');
          if (loader) loader.style.display = 'none';

          // Add a small delay to check if render actually worked + enforce AX standards
          setTimeout(() => {
            const content = document.getElementById('root').innerHTML;
            console.log('[Preview] Root innerHTML after render (first 200 chars):', content.substring(0, 200));
            if (!content || content.trim() === '') {
              console.error('[Preview] ✗ Root is empty after render! Component may have returned null or errored silently.');
              console.error('[Preview] Check if component is using undefined shadcn components or has syntax errors.');
            }

            // AX-5 POST-RENDER ENFORCEMENT: Convert extra h1 elements to h2
            // Use MutationObserver to catch React re-renders
            function enforceH1Rule() {
              var h1s = document.querySelectorAll('h1');
              if (h1s.length > 1) {
                for (var i = 1; i < h1s.length; i++) {
                  var h2 = document.createElement('h2');
                  for (var j = 0; j < h1s[i].attributes.length; j++) {
                    h2.setAttribute(h1s[i].attributes[j].name, h1s[i].attributes[j].value);
                  }
                  h2.innerHTML = h1s[i].innerHTML;
                  h1s[i].parentNode.replaceChild(h2, h1s[i]);
                }
                console.log('[Preview] AX-5: Converted ' + (h1s.length - 1) + ' extra h1 to h2');
              }
            }
            enforceH1Rule();
            // Re-enforce after React state changes
            var axObserver = new MutationObserver(function() { setTimeout(enforceH1Rule, 50); });
            axObserver.observe(document.getElementById('root'), { childList: true, subtree: true });
            // Stop observing after 10 seconds
            setTimeout(function() { axObserver.disconnect(); }, 10000);
          }, 100);
        } else {
          console.error('[Preview] ✗ Component not found!');
          document.getElementById('root').innerHTML =
            '<div style="padding: 40px; max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif; text-align: center;">' +
            '<svg style="width: 64px; height: 64px; margin: 0 auto 20px; color: #9ca3af;" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
            '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>' +
            '</svg>' +
            '<h2 style="font-size: 24px; font-weight: 600; color: #111827; margin-bottom: 12px;">Component Not Found</h2>' +
            '<p style="color: #6b7280; margin-bottom: 20px;">The generated code executed successfully, but no component function could be identified.</p>' +
            '<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: left;">' +
            '<p style="font-size: 14px; color: #374151; margin-bottom: 8px; font-weight: 500;">Expected component names:</p>' +
            '<code style="display: block; font-size: 13px; color: #6b7280; line-height: 1.6;">Dashboard, ProjectDashboard, App, Counter, TodoList, ProductList, LandingPage, etc.</code>' +
            '</div>' +
            '<button onclick="window.parent.location.reload()" style="background: rgb(59, 130, 246); color: white; border: none; padding: 10px 24px; border-radius: 6px; font-weight: 500; cursor: pointer;">Try Regenerating</button>' +
            '</div>';
        }
      } catch (error) {
        console.error('[Preview] ✗ Error during execution:', error);
        var _esc = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
        document.getElementById('root').innerHTML =
          '<div style="padding: 20px; color: red;">' +
          '<h3>Error rendering component</h3>' +
          '<pre>' + _esc(error.message) + '</pre>' +
          '</div>';
      }
      } // end else !__BABEL_FAILED__
    </script>
</body>
</html>
  `.trim()

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      // Allow iframe embedding and external resources
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'unsafe-eval' 'unsafe-inline' 'self' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' 'self' https://cdn.tailwindcss.com https://fonts.googleapis.com; img-src 'self' data: https: http:; font-src 'self' data: https: https://fonts.gstatic.com; connect-src 'self' https:; frame-ancestors 'self';",
      // Allow SAMEORIGIN so iframe can load within our app
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
    },
  })
}// Force redeploy Sat Jun 13 20:27:26 PDT 2026
