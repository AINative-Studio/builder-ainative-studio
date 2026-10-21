/**
 * Shared Sandpack files pipeline, extracted from components/chat/sandpack-preview.tsx
 * (2026-10-15) so the real preview component and scripts/fixtures/sandpack-verify's
 * --chat-id verification harness run the EXACT same logic.
 *
 * WHY THIS EXISTS: the --chat-id harness (scripts/fixtures/sandpack-verify/chat-id.ts)
 * fetched raw generated files and sent them straight to the bundler, skipping this
 * fix pipeline entirely (path-alias rewrite, missing-import safety nets, de-dupe).
 * That produced false FAILs — a real app ("Wallify", chatId
 * z4nabGqvy_UURyaKnCY8J) "failed" in the harness with "Separator is not defined"
 * while the real live /preview/{id} page rendered it with zero console errors,
 * because only the real page's SandpackPreview component ran the shadcn
 * import-injection safety net that adds the missing `import { Separator } from
 * './components/ui/separator'` line. Extracting this logic once means the harness
 * can never drift out of sync with what production actually does again.
 */
import { fixJsxErrors } from './jsx-fixer'
import { getBuiltinFiles } from './setup'
import { sanitizeForSandpack } from '../code-validator'

/**
 * Build the final Sandpack `files` map from a generated app's raw files map,
 * exactly as components/chat/sandpack-preview.tsx does: overlay onto builtins,
 * normalize /src and /app paths, assemble /App.tsx as the entry point, then run
 * the React/AIKit/shadcn/lucide import-injection safety nets + final de-dupe on
 * every generated .tsx file.
 */
export function buildSandpackFiles(files: Record<string, string>): Record<string, string> {
  const sandpackFiles: Record<string, string> = { ...getBuiltinFiles() }

  for (const [rawPath, rawContent] of Object.entries(files)) {
    const path = rawPath
    if (path.endsWith('.txt') || path.endsWith('.xml') || (path.endsWith('.json') && path.includes('well-known'))) {
      continue
    }
    // Real bug found live (2026-10-19, tidemark): Next.js App Router
    // convention files (layout.tsx, sitemap.ts, robots.ts) are generated for
    // the REAL deployed app — layout.tsx in particular commonly imports
    // next/font/google, a module that only exists in a real Next.js runtime.
    // Sandpack's preview sandbox is a plain `react-ts` template with no
    // Next.js runtime at all, and these files are never the preview's entry
    // point — but buildSandpackFiles() included them anyway (no filter
    // existed), so Sandpack's own dependency walker tried to resolve
    // next/font/google, failed with "Cannot find module", and silently
    // failed the whole compile with zero error surfaced to the parent page
    // (confirmed live via Sandpack's own relayed console message). The
    // actual mechanism (confirmed by reading the self-hosted sandpack-
    // bundler fork's source, src/bundler/bundler.ts): `collectAppBarrelUsage`
    // scans every file's imports and calls `resolveAsync` on each specifier
    // for ALL provided files, not just ones reachable from the real
    // '/App.tsx' entry — so an unresolvable import in ANY generated file,
    // reachable or not, rejects that shared promise and silently fails the
    // whole compile. Extended (2026-10-20, static analysis, not yet an
    // individually-confirmed-live repro the way layout.tsx was) to the same
    // class of Next.js-only convention file carrying the identical risk:
    // route handlers and middleware import `next/server`
    // (NextRequest/NextResponse), and the image-metadata convention files
    // import `ImageResponse` from `next/og` — neither module exists in
    // Sandpack's plain react-ts template either, and none of these files is
    // ever the preview's entry point or renders anything a founder would
    // see in the preview. Skip these — they describe the real app's shell,
    // not anything the preview sandbox needs or can run. Extended again
    // (2026-10-20, static analysis, issue #1143) with the remaining official
    // App Router special-file basenames not yet covered: loading/error
    // (error.tsx is required to be a Client Component and sometimes imports
    // next/navigation)/global-error (replaces the root layout when active —
    // same <html>/<body> + possible next/font risk as layout.tsx)/not-found/
    // default (parallel routes)/template — none of these is ever reachable
    // from the preview's real entry ('/App.tsx') either.
    const basename = path.slice(path.lastIndexOf('/') + 1)
    if (
      /^(layout|sitemap|robots|middleware|instrumentation|route|opengraph-image|twitter-image|icon|apple-icon|manifest|loading|error|global-error|not-found|default|template)\.tsx?$/.test(
        basename
      )
    ) {
      continue
    }
    let content = rawContent
    if (/\.(t|j)sx?$/.test(path)) {
      try { content = sanitizeForSandpack(rawContent) } catch { content = rawContent }
    }
    sandpackFiles[path] = content

    if (path.startsWith('/src/') && !path.includes('/App.tsx')) {
      const rootPath = path.replace(/^\/src\//, '/')
      sandpackFiles[rootPath] = content
    }
    if (path.startsWith('/src/app/') || path.startsWith('/app/')) {
      const rootPath = path.replace(/^\/src\/app\//, '/app/').replace(/^\/app\//, '/app/')
      sandpackFiles[rootPath] = content
      if (path.endsWith('/page.tsx') || path.endsWith('/page.ts')) {
        const dirPath = rootPath.replace(/\/page\.tsx?$/, '')
        if (dirPath !== '') {
          sandpackFiles[dirPath + '.tsx'] = content
        }
      }
    }
  }

  const mainFile = Object.keys(sandpackFiles).find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || Object.keys(sandpackFiles).find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || Object.keys(sandpackFiles)[0]

  let mainCode = mainFile ? sandpackFiles[mainFile] : ''

  mainCode = mainCode.replace(/from\s+['"]\.\/src\//g, "from './")
  mainCode = mainCode.replace(/from\s+['"]\.\/app\/page['"]/g, "from './app/page'")

  if (mainCode && !mainCode.includes('import React')) {
    const needsHooks = /\b(useState|useEffect|useRef|useMemo|useCallback|useContext|useReducer)\b/.test(mainCode)
    const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
      .filter(h => mainCode.includes(h))
    if (needsHooks) {
      mainCode = `import React, { ${hooks.join(', ')} } from 'react'\n${mainCode}`
    } else {
      mainCode = `import React from 'react'\n${mainCode}`
    }
  }

  if (mainCode && !mainCode.includes('export default')) {
    const match = mainCode.match(/function\s+([A-Z]\w+)/)
    if (match) {
      mainCode += `\n\nexport default ${match[1]}`
    }
  }

  // Real content length BEFORE any preamble is added below, so the reveal
  // timeout (lib/sandpack/setup.ts's /index.tsx) scales to what Tailwind's
  // JIT actually has to compile, not an inflated count. Set as a top-level
  // side effect so it runs when '/index.tsx' does `import App from './App'`
  // — before that file's own revealOnceStyled() call reads it.
  if (mainCode) {
    mainCode = `;(window as any).__APP_SOURCE_CHARS__ = ${mainCode.length};\n${mainCode}`
  }

  sandpackFiles['/App.tsx'] = mainCode

  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (!path.endsWith('.tsx')) continue
    if (builtinPaths.has(path)) continue

    // The safety-net injections below need a path to the builtin
    // components/ui and aikit directories THAT'S RELATIVE TO THIS FILE'S OWN
    // LOCATION, not a hardcoded './components/...' — a file already living
    // directly inside /src/components/ or /components/ (the common case for
    // any real multi-file app's sub-components, e.g.
    // /src/components/Sidebar.tsx) would otherwise get an injected import
    // resolving to /src/components/components/ui/button, which doesn't
    // exist ("Cannot find module", confirmed live 2026-10-15 across multiple
    // real apps — getBuiltinFiles() duplicates every shadcn/AIKit builtin to
    // BOTH /components/* and /src/components/*, precisely so a same-level
    // relative import always resolves correctly). A file at /App.tsx or
    // /src/App.tsx needs './components/ui/...'; a file whose OWN directory
    // is exactly .../components (not components itself — a file nested one
    // level further, e.g. .../components/sub/, is not a shape real codegen
    // here produces, so it's intentionally not special-cased) needs just
    // './ui/...' (and './aikit' instead of './components/aikit') since
    // components/ui and components/aikit are its siblings, not its children.
    const dir = path.slice(0, path.lastIndexOf('/'))
    const dirIsComponentsItself = /\/components$/.test(dir) || dir === 'components'
    const componentsPrefix = dirIsComponentsItself ? './' : './components/'

    let fixed = code
      .replace(/from ['"]@\/components\//g, "from './components/")
      .replace(/from ['"]@\/lib\//g, "from './lib/")
      .replace(/from ['"]@\//g, "from './")

    fixed = fixJsxErrors(fixed)

    // Real bug (confirmed live 2026-10-15, two real apps — "Wallify"'s
    // Hero.tsx and a second real app's Header.tsx): the MODEL ITSELF (not
    // this file's own injection logic) sometimes writes an import like
    // `from './components/aikit'` or `from './components/ui/button'` that's
    // only correct from a root-level file (/App.tsx, /src/App.tsx) — when
    // that exact literal path is hardcoded inside a file that ALREADY lives
    // inside a components/ directory (e.g. /src/components/Hero.tsx), it
    // resolves to the nonexistent .../components/components/... and crashes
    // Sandpack with "Cannot find module". This is a different code path from
    // the injection-depth fix above: that one only fires for imports THIS
    // function adds because they were MISSING; this one corrects a wrong
    // depth in an import the model already wrote, which the injection
    // guards never touch since they only act on names with no existing
    // import at all. Runs before injection so injection's "already
    // imported" checks see the corrected (not the stale) path.
    fixed = fixed.replace(
      /from\s+(['"])(\.\.?\/)*components\/(ui\/[a-z-]+|aikit)\1/g,
      (_match, quote: string, _dots: string, rest: string) => `from ${quote}${componentsPrefix}${rest}${quote}`
    )

    if (!fixed.includes("from 'react'") && !fixed.includes('from "react"')) {
      const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
        .filter(h => fixed.includes(h))
      if (hooks.length > 0) {
        fixed = `import React, { ${hooks.join(', ')} } from 'react'\n${fixed}`
      } else {
        fixed = `import React from 'react'\n${fixed}`
      }
    }

    {
      const aikitComponents = [
        'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
        'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
        'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
        'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
        'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
        'AIKitStepper', 'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
      ]
      const usedAikit = aikitComponents.filter(c =>
        new RegExp(`<${c}[\\s/>]`).test(fixed) &&
        !new RegExp(`import\\s+.*\\b${c}\\b.*from\\s+`).test(fixed)
      )
      if (usedAikit.length > 0) {
        fixed = `import { ${usedAikit.join(', ')} } from '${componentsPrefix}aikit'\n${fixed}`
      }
    }

    {
      const shadcnMap: Record<string, string[]> = {
        'ui/button': ['Button'],
        'ui/card': ['Card', 'CardHeader', 'CardContent', 'CardTitle', 'CardDescription', 'CardFooter'],
        'ui/badge': ['Badge'],
        'ui/avatar': ['Avatar', 'AvatarImage', 'AvatarFallback'],
        'ui/input': ['Input'],
        'ui/tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'],
        'ui/label': ['Label'],
        'ui/table': ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'],
        'ui/separator': ['Separator'],
        'ui/progress': ['Progress', 'CircularProgress'],
        'ui/alert': ['Alert', 'AlertTitle', 'AlertDescription'],
        'ui/dialog': ['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter'],
        'ui/select': ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'],
        'ui/checkbox': ['Checkbox', 'RadioGroup', 'RadioGroupItem'],
        'ui/accordion': ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'],
      }
      const imports: string[] = []
      for (const [mod, components] of Object.entries(shadcnMap)) {
        const used = components.filter(c =>
          // #1165: was `<${c}[\\s/>]|\\b${c}\\b` — the bare `\b${c}\b`
          // fallback matched plain English prose containing the component
          // name as an ordinary word (confirmed live: "Select mild,
          // medium, or wild" in a founder's own copy text spuriously
          // injected `import { Select } from './components/ui/select'`,
          // a real, unused import with nothing to do with JSX at all).
          // Only the real JSX-tag-opening pattern is a legitimate signal
          // this component is actually rendered — matches the AIKit
          // injection guard just below, which never had this bug.
          new RegExp(`<${c}[\\s/>]`).test(fixed) &&
          !new RegExp(`import\\s+.*\\b${c}\\b.*from\\s+`).test(fixed)
        )
        if (used.length > 0) {
          imports.push(`import { ${used.join(', ')} } from '${componentsPrefix}${mod}'`)
        }
      }
      if (imports.length > 0) {
        fixed = imports.join('\n') + '\n' + fixed
      }
    }

    // Real bug (confirmed live 2026-10-15): this used to be gated behind
    // `if (!fixed.includes("from 'lucide-react'"))`, so a file that already
    // imports SOME lucide icons (e.g. `import { Tag } from 'lucide-react'`)
    // but uses another one the model forgot (e.g. `icon: Shield` inside an
    // object literal) never got that missing icon injected at all — the
    // guard assumed "has a lucide import" means "has everything it needs,"
    // which isn't true when the model's own import list is incomplete.
    // Compute missing icons unconditionally; merge into the existing import
    // statement when one exists, otherwise add a new one, same as the
    // shadcn/AIKit injections above already do.
    {
      const allLucideIcons = [
        'Activity', 'AlertCircle', 'AlertTriangle', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
        'Award', 'BarChart', 'BarChart2', 'BarChart3', 'Bell', 'Book', 'BookOpen', 'Bot',
        'Brain', 'Briefcase', 'Calendar', 'Camera', 'Check', 'CheckCircle', 'CheckCircle2',
        'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp', 'Circle', 'CircleDot', 'Clock', 'Cloud',
        'Code', 'Code2', 'Cog', 'Command', 'Copy', 'CreditCard', 'Crown',
        'Database', 'DollarSign', 'Download', 'Edit', 'Edit2', 'Edit3', 'ExternalLink', 'Eye', 'EyeOff',
        'Facebook', 'File', 'FileText', 'Filter', 'Flag', 'Flame', 'Folder', 'FolderOpen',
        'Gift', 'Github', 'Globe', 'Grid', 'Grip', 'Hash', 'Headphones', 'Heart', 'HelpCircle', 'Home',
        'Image', 'Inbox', 'Info', 'Instagram', 'Key', 'Laptop', 'Layout', 'LayoutDashboard',
        'Layers', 'Library', 'Lightbulb', 'LineChart', 'Link', 'Linkedin', 'List', 'Loader', 'Loader2',
        'Lock', 'LogIn', 'LogOut', 'Mail', 'Map', 'MapPin', 'Maximize', 'Maximize2',
        'Menu', 'MessageCircle', 'MessageSquare', 'Mic', 'Minimize', 'Minimize2', 'Minus', 'Monitor',
        'Moon', 'MoreHorizontal', 'MoreVertical', 'Mountain', 'MousePointer', 'Music', 'Navigation',
        'Package', 'Palette', 'Paperclip', 'Pause', 'PenTool', 'Percent', 'Phone', 'PieChart',
        'Pin', 'Play', 'PlayCircle', 'Plus', 'PlusCircle', 'Podcast', 'Power',
        'Printer', 'QrCode', 'Quote', 'Radio', 'RefreshCw', 'Repeat', 'Reply', 'Rocket',
        'RotateCcw', 'RotateCw', 'Rss', 'Save', 'Scale', 'Scan', 'Search', 'Send', 'Server',
        'Settings', 'Settings2', 'Share', 'Share2', 'Shield', 'ShieldCheck', 'ShoppingBag',
        'ShoppingCart', 'Shuffle', 'Sidebar', 'Signal', 'Slack', 'Sliders', 'Smartphone',
        'Smile', 'Sparkle', 'Sparkles', 'Speaker', 'Square', 'Star', 'Sun', 'Sunrise', 'Sunset',
        'Swords', 'Table', 'Tablet', 'Tag', 'Target', 'Terminal', 'ThumbsDown', 'ThumbsUp',
        'Timer', 'ToggleLeft', 'ToggleRight', 'Tool', 'Trash', 'Trash2', 'TrendingDown', 'TrendingUp',
        'Triangle', 'Trophy', 'Truck', 'Tv', 'Twitter', 'Type', 'Umbrella', 'Underline',
        'Undo', 'Unlock', 'Upload', 'UploadCloud', 'User', 'UserCheck', 'UserMinus', 'UserPlus',
        'Users', 'Video', 'Volume', 'Volume1', 'Volume2', 'VolumeX', 'Wallet', 'Wand', 'Wand2',
        'Watch', 'Wifi', 'WifiOff', 'Wind', 'Wrench', 'X', 'XCircle', 'Youtube', 'Zap', 'ZoomIn', 'ZoomOut',
      ]
      // An icon already present in SOME existing lucide-react import
      // statement (any quote style) doesn't need to be injected again —
      // only truly missing icons do.
      const existingImportMatch = fixed.match(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/)
      const alreadyImported = new Set(
        (existingImportMatch?.[1] ?? '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      )
      // #1165: was a bare `\b${icon}\b` anywhere in the file — matched the
      // icon name as an ordinary English word in prose/JSX text content,
      // object keys, or unrelated identifiers with zero connection to an
      // actual icon usage (confirmed live, habanero-hub: "Gift
      // Subscriptions" link text, a "Jalapeño Sunrise" flavor name, the
      // "Navigation" JSX comment, "Content-Type" header strings, and
      // "Key features"/"Reorder & Share" copy each spuriously injected
      // Gift/Sunrise/Navigation/Type/Key/Share into the lucide-react
      // import, even though none was ever actually rendered). Real usage
      // is either a JSX tag (`<Icon`) or the documented `icon: Icon` /
      // `icon={Icon}` object-property-reference pattern (see this
      // injection's own doc comment above, written for exactly that case)
      // — require one of those, not a bare word appearing anywhere.
      const missingIcons = allLucideIcons.filter(icon =>
        new RegExp(`<${icon}[\\s/>]|\\bicon:\\s*${icon}\\b|\\bicon=\\{${icon}\\}`).test(fixed) &&
        !alreadyImported.has(icon)
      )
      if (missingIcons.length > 0) {
        if (existingImportMatch) {
          const merged = [...alreadyImported, ...missingIcons].join(', ')
          fixed = fixed.replace(existingImportMatch[0], `import { ${merged} } from 'lucide-react'`)
        } else {
          fixed = `import { ${missingIcons.join(', ')} } from 'lucide-react'\n${fixed}`
        }
      }
    }

    try { fixed = sanitizeForSandpack(fixed) } catch { /* keep fixed as-is */ }

    sandpackFiles[path] = fixed
  }

  stubMissingLocalComponents(sandpackFiles)

  return sandpackFiles
}

/**
 * Real bug found live (2026-10-20, Dispatch): a generated app's own files
 * can import a sibling component that the generation genuinely never
 * produced (confirmed: /src/App.tsx imports './components/Footer', but no
 * Footer.tsx exists anywhere in the real files map returned by
 * /api/generation/{chatId}/files — a content-generation gap, not a path-
 * resolution bug the existing shadcn/lucide/AIKit safety nets above cover).
 * Sandpack's bundler fails the ENTIRE preview with "Cannot find module" for
 * this one missing file, even though every OTHER component rendered fine.
 *
 * Mirrors the existing safety-net philosophy in this file: a generation gap
 * must degrade gracefully, never take down the whole preview. Scans every
 * non-builtin file for a relative import (`./X`, `./components/X`, `../X`)
 * whose resolved path has no matching key in sandpackFiles, and synthesizes
 * an inert stub component at that exact path — so the import resolves, the
 * rest of the app renders, and the ONLY visible gap is the specific missing
 * section (rendering nothing) rather than the entire page crashing.
 *
 * Deliberately conservative: only synthesizes a stub for a path that is
 * genuinely absent after every real pass above (builtins, shadcn/AIKit
 * injection, de-dupe) has already run — a real file at that path always
 * wins, this never overwrites one.
 */
function stubMissingLocalComponents(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const importRe = /from\s+['"](\.\.?\/[^'"]+)['"]/g

  // Collect candidate missing paths first — mutating sandpackFiles while
  // iterating imports found across it could make a later stub's own file
  // content get re-scanned; two passes keeps this deterministic.
  const toStub = new Set<string>()

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const resolved = resolveRelativeImport(dir, match[1])
      if (!resolved) continue
      // #1165 follow-up: must check BOTH index.tsx and index.ts — the real
      // AIKit builtin lives at /components/aikit/index.ts (a .ts file, not
      // .tsx). Missing that candidate here made this treat the already-real
      // './components/aikit' import as missing and synthesize a conflicting
      // stub at /components/aikit.tsx, which then won module resolution over
      // the real directory module and rendered MetricCard as undefined —
      // confirmed live on habanero-hub even after the import-injection fix.
      const candidates = [
        resolved,
        `${resolved}.tsx`,
        `${resolved}.ts`,
        `${resolved}/index.tsx`,
        `${resolved}/index.ts`,
      ]
      const exists = candidates.some((c) => c in sandpackFiles)
      if (!exists) toStub.add(`${resolved}.tsx`)
    }
  }

  for (const stubPath of toStub) {
    if (stubPath in sandpackFiles) continue // a real pass already provided it
    const name = (stubPath.split('/').pop() || 'Missing').replace(/\.tsx$/, '')
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue // not a valid component identifier, skip
    sandpackFiles[stubPath] =
      `import React from 'react'\n// Auto-stubbed: the generation did not produce this file (${stubPath}).\nexport default function ${name}() { return null }\n`
  }
}

/** Resolve a relative import specifier against the importing file's directory. Returns null for anything that isn't a plain relative path this app's own files would use. */
function resolveRelativeImport(fromDir: string, spec: string): string | null {
  const parts = fromDir.split('/').filter(Boolean)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') { parts.pop(); continue }
    parts.push(seg)
  }
  const resolved = `/${parts.join('/')}`
  return /^\/[\w\-./]+$/.test(resolved) ? resolved : null
}

/**
 * Detect whether the generated app's own files (excluding builtins) reference
 * lucide-react/recharts — see sandpack-preview.tsx's #1089/#1097 comment for why
 * this conservative substring check is safe (a false positive only costs what
 * unconditional declaration already cost; a false negative never happens because
 * the literal package-name substring can only appear via a real import).
 */
export function detectSandpackDependencies(sandpackFiles: Record<string, string>): {
  usesLucideReact: boolean
  usesRecharts: boolean
} {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const generatedCode = Object.entries(sandpackFiles)
    .filter(([path]) => !builtinPaths.has(path))
    .map(([, code]) => code)
    .join('\n')
  return {
    usesLucideReact: generatedCode.includes('lucide-react'),
    usesRecharts: generatedCode.includes('recharts'),
  }
}
