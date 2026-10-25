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

  const builtinPathsForEntry = new Set(Object.keys(getBuiltinFiles()))
  const generatedPaths = Object.keys(sandpackFiles).filter(f => !builtinPathsForEntry.has(f))

  const mainFile = generatedPaths.find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || generatedPaths.find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || null

  // Real bug (#1099 item 8): a generation can produce only sibling
  // component files with no App.tsx/page.tsx anywhere -- the one thing
  // this pipeline genuinely cannot invent (mirrors company-scaffold.ts's
  // hasDeployableEntrypoint(), which treats this exact condition as "not
  // deployable yet" for the real deploy path). Previously this fell
  // through to `Object.keys(sandpackFiles)[0]` -- an arbitrary BUILTIN
  // file (shadcn/AIKit/template get spread into sandpackFiles first),
  // producing nonsense entry content and a raw babel parse error instead
  // of a clear message a founder could actually understand.
  const NO_ENTRYPOINT_FALLBACK = [
    "import React from 'react'",
    'export default function App() {',
    '  return (',
    "    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>",
    '      <div>',
    "        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>This page hasn't been generated yet</h1>",
    "        <p style={{ color: '#666' }}>No landing page content was produced for this company. Try regenerating, or check back shortly.</p>",
    '      </div>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')

  let mainCode = mainFile ? sandpackFiles[mainFile] : NO_ENTRYPOINT_FALLBACK

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

  // Real bug found live (#1099 item 4, "LoginIcon is not defined"): a
  // sibling generated file can genuinely define and export a local
  // (non-library) component that another file uses in JSX without ever
  // importing it — the file exists, so stubMissingLocalComponents() below
  // (which only reacts to an import specifier that doesn't resolve) never
  // sees anything wrong. Built once, before any file's own content is
  // mutated by the injection passes below, so export statements are read
  // from each file's original generated source.
  const localExportMap = buildLocalExportMap(sandpackFiles, builtinPaths)

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
        'ui/dialog': ['Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter'],
        'ui/select': ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'],
        'ui/checkbox': ['Checkbox', 'RadioGroup', 'RadioGroupItem'],
        'ui/accordion': ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'],
        // This map had drifted out of sync with lib/sandpack/shadcn-bundle.ts's
        // real export surface — same shape as #1248 (AIKIT_COMPONENTS missing
        // VideoPlayer/StreamingText/MediaGallery). A model using any of these
        // without an explicit import sailed through this safety net unfixed.
        'ui/popover': ['Popover', 'PopoverTrigger', 'PopoverContent'],
        'ui/switch': ['Switch'],
        'ui/textarea': ['Textarea'],
        'ui/tooltip': ['Tooltip', 'TooltipProvider', 'TooltipTrigger', 'TooltipContent'],
        'ui/dropdown-menu': ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuSeparator'],
        'ui/scroll-area': ['ScrollArea', 'ScrollBar'],
        'ui/skeleton': ['Skeleton'],
        'ui/slider': ['Slider'],
        'ui/toast': ['Toast', 'ToastDescription', 'ToastTitle'],
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

    // Inject a missing import for a locally-defined sibling component used
    // in JSX but never imported (see localExportMap comment above). Grouped
    // by source file so multiple names from the same sibling become one
    // import statement, same as the shadcn injection above.
    {
      const selfPath = normalizeForRelative(path)
      const byFile = new Map<string, string[]>()
      for (const [name, exportingPath] of localExportMap) {
        if (exportingPath === selfPath) continue
        if (!new RegExp(`<${name}[\\s/>]`).test(fixed)) continue
        if (
          new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`).test(fixed) ||
          new RegExp(`import\\s+${name}\\b`).test(fixed)
        ) continue
        const rel = relativeImportPath(path, exportingPath)
        if (!byFile.has(rel)) byFile.set(rel, [])
        byFile.get(rel)!.push(name)
      }
      if (byFile.size > 0) {
        const importLines = Array.from(byFile.entries()).map(
          ([rel, names]) => `import { ${names.join(', ')} } from '${rel}'`
        )
        fixed = importLines.join('\n') + '\n' + fixed
      }
    }

    try { fixed = sanitizeForSandpack(fixed) } catch { /* keep fixed as-is */ }

    sandpackFiles[path] = fixed
  }

  fixExportShapeMismatches(sandpackFiles)
  stubMissingLocalComponents(sandpackFiles)

  return sandpackFiles
}

/**
 * Real bug class matching "Element type is invalid": a sibling component
 * file genuinely EXISTS and its import specifier resolves fine, but the
 * importing file requests the WRONG export shape — a bare default import
 * (`import Footer from './components/Footer'`) of a file that only exports
 * a NAMED `Footer` (`export const Footer = ...`), or the inverse
 * (`import { Footer } from './components/Footer'` of a file that only has
 * `export default function Footer()`). Neither case throws at parse time —
 * the specifier resolves, the file exists — but the imported binding is
 * `undefined` at runtime, so `<Footer/>` throws exactly "Element type is
 * invalid: ... got: undefined", indistinguishable to the user from a
 * genuinely missing component. None of this file's other safety nets catch
 * it: stubMissingLocalComponents() only reacts to a specifier that doesn't
 * resolve to any file at all, and the missing-local-export injector above
 * only ever ADDS a brand-new import — it never corrects an EXISTING one.
 *
 * Deliberately conservative — only rewrites the single-binding, unambiguous
 * shape (no mixed `import Foo, { Bar }` clauses): a bare default import
 * whose identifier exactly matches one of the target's real named exports,
 * or a single named import whose specifier the target does NOT export by
 * name but DOES export as its default. A genuinely missing/misspelled
 * export (neither shape matches) is left alone rather than guessed at.
 */
function fixExportShapeMismatches(sandpackFiles: Record<string, string>): void {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const importRe = /^[ \t]*import\s+([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm

  const shapeCache = new Map<string, { hasDefault: boolean; named: Set<string> } | null>()
  function shapeOf(resolved: string): { hasDefault: boolean; named: Set<string> } | null {
    if (shapeCache.has(resolved)) return shapeCache.get(resolved)!
    const candidates = [resolved, `${resolved}.tsx`, `${resolved}.ts`, `${resolved}/index.tsx`, `${resolved}/index.ts`]
    const real = candidates.find((c) => c in sandpackFiles)
    const shape = real
      ? {
          hasDefault: /export\s+default\b/.test(sandpackFiles[real]),
          named: new Set(
            [...sandpackFiles[real].matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)].map(
              (m) => m[1],
            ),
          ),
        }
      : null
    shapeCache.set(resolved, shape)
    return shape
  }

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    const edits: { from: string; to: string }[] = []
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const clause = match[1].trim()
      if (/^type\s/.test(clause)) continue
      const resolved = resolveRelativeImport(dir, match[2])
      if (!resolved) continue
      const shape = shapeOf(resolved)
      if (!shape) continue // genuinely missing — stubMissingLocalComponents' job

      const bareDefault = clause.match(/^([A-Za-z_$][\w$]*)$/)
      if (bareDefault && !shape.hasDefault && shape.named.has(bareDefault[1])) {
        const name = bareDefault[1]
        const replaced = match[0].replace(new RegExp(`import\\s+${name}\\b`), `import { ${name} }`)
        if (replaced !== match[0]) edits.push({ from: match[0], to: replaced })
        continue
      }

      const singleNamed = clause.match(/^\{\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}$/)
      if (singleNamed) {
        const exported = singleNamed[1]
        const local = singleNamed[2] || singleNamed[1]
        if (!shape.named.has(exported) && shape.hasDefault) {
          const aliasPart = singleNamed[2] ? `\\s+as\\s+${local}` : ''
          const replaced = match[0].replace(new RegExp(`\\{\\s*${exported}(?:${aliasPart})?\\s*\\}`), local)
          if (replaced !== match[0]) edits.push({ from: match[0], to: replaced })
        }
      }
    }
    if (edits.length > 0) {
      let fixed = code
      for (const { from, to } of edits) fixed = fixed.replace(from, to)
      sandpackFiles[path] = fixed
    }
  }
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
  // Captures the import clause too (not just the path) — #1122's original
  // version only tracked WHICH paths were missing, not WHAT each importer
  // actually needed from them. See needsDefault/namedExports below.
  const importRe = /^[ \t]*import\s+(?:type\s+)?([^'";]*?)\s*from\s*['"](\.\.?\/[^'"]+)['"]/gm

  // Collect candidate missing paths first — mutating sandpackFiles while
  // iterating imports found across it could make a later stub's own file
  // content get re-scanned; two passes keeps this deterministic.
  const toStub = new Map<string, { needsDefault: boolean; namedExports: Set<string> }>()

  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const dir = path.slice(0, path.lastIndexOf('/')) || ''
    let match: RegExpExecArray | null
    importRe.lastIndex = 0
    while ((match = importRe.exec(code))) {
      const clause = match[1]
      const resolved = resolveRelativeImport(dir, match[2])
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
      if (!exists) {
        const stubPath = `${resolved}.tsx`
        const needs = toStub.get(stubPath) ?? { needsDefault: false, namedExports: new Set<string>() }
        const { needsDefault, named } = parseMissingImportClause(clause)
        needs.needsDefault ||= needsDefault
        for (const n of named) needs.namedExports.add(n)
        toStub.set(stubPath, needs)
      }
    }
  }

  for (const [stubPath, needs] of toStub) {
    if (stubPath in sandpackFiles) continue // a real pass already provided it
    const name = (stubPath.split('/').pop() || 'Missing').replace(/\.tsx$/, '')
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue // not a valid component identifier, skip

    const lines = [
      `import React from 'react'`,
      `// Auto-stubbed: the generation did not produce this file (${stubPath}).`,
    ]
    // Default export, same as before — kept even when nothing observed a
    // default import of this path, so a stub is never a strict regression
    // of #1122's original always-default behavior.
    if (needs.needsDefault || needs.namedExports.size === 0) {
      lines.push(`export default function ${name}() { return null }`)
    }
    // #1122 follow-up: a genuinely missing sibling can just as easily be
    // imported by NAME (`import { Footer } from './components/Footer'`) as
    // by default. A default-only stub leaves that named binding undefined,
    // so rendering it still throws "Element type is invalid" — the exact
    // whole-preview crash this function exists to prevent, just reached via
    // the named-import path instead. Stub every named export actually
    // observed so each one resolves to an inert component too.
    for (const named of needs.namedExports) {
      if (!/^[A-Za-z_$][\w$]*$/.test(named)) continue
      lines.push(`export const ${named} = () => null`)
    }
    sandpackFiles[stubPath] = lines.join('\n') + '\n'
  }
}

/** Parses an import clause into what a missing module stub must provide: a default export, and/or specific named exports (by their EXPORTED name, not any local alias — the stub is matched against the module's real export surface, which aliasing on the import side never changes). */
function parseMissingImportClause(clause: string): { needsDefault: boolean; named: string[] } {
  const trimmed = clause.trim()
  if (!trimmed) return { needsDefault: false, named: [] }

  if (/^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(trimmed)) {
    // `import * as X from '...'` never throws on a missing named export —
    // X is just a (possibly empty) module namespace object. No stub needed.
    return { needsDefault: false, named: [] }
  }

  const braceMatch = trimmed.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}$/)
  if (braceMatch) {
    const named: string[] = []
    for (const raw of braceMatch[2].split(',').map((n) => n.trim()).filter(Boolean)) {
      // Inline type-only specifier (`type Foo`) has no runtime value to stub.
      if (/^type\s+[A-Za-z_$][\w$]*(?:\s+as\s+[A-Za-z_$][\w$]*)?$/.test(raw)) continue
      const aliasMatch = raw.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      named.push(aliasMatch ? aliasMatch[1] : raw)
    }
    return { needsDefault: Boolean(braceMatch[1]), named }
  }

  const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)$/)
  return { needsDefault: Boolean(defaultMatch), named: [] }
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
 * Scans every non-builtin generated file for a top-level named export
 * (`export const/function/class Name`) and returns a name -> logical file
 * path map, for injecting a missing import when another generated file
 * uses that name in JSX without importing it (see #1099 item 4). A name
 * exported from two genuinely different files is dropped entirely rather
 * than guessed — an unresolved ambiguity is strictly safer than a wrong
 * import.
 */
function buildLocalExportMap(sandpackFiles: Record<string, string>, builtinPaths: Set<string>): Map<string, string> {
  const exportRe = /export\s+(?:const|function|class)\s+([A-Z]\w*)/g
  const map = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (builtinPaths.has(path) || !/\.(t|j)sx?$/.test(path)) continue
    const normalized = normalizeForRelative(path)
    let match: RegExpExecArray | null
    exportRe.lastIndex = 0
    while ((match = exportRe.exec(code))) {
      const name = match[1]
      const existing = map.get(name)
      if (existing !== undefined && existing !== normalized) {
        ambiguous.add(name)
        continue
      }
      map.set(name, normalized)
    }
  }
  for (const name of ambiguous) map.delete(name)
  return map
}

/**
 * buildSandpackFiles() mirrors every non-entry `/src/X` file to `/X` (see
 * the assembly loop above) so a same-level relative import always resolves
 * regardless of which style a file was generated under. Both copies carry
 * identical content, so stripping the `/src/` prefix collapses them to the
 * same logical path for cross-file export lookups and relative-path math.
 */
function normalizeForRelative(path: string): string {
  return path.replace(/^\/src\//, '/')
}

/** Compute a relative import specifier from one generated file to another, via each file's logical (post-normalizeForRelative) path — independent of which /src-vs-root duplicate either side happens to be. */
function relativeImportPath(fromPath: string, toPath: string): string {
  const fromDir = normalizeForRelative(fromPath).replace(/\/[^/]*$/, '')
  const toNoExt = normalizeForRelative(toPath).replace(/\.(t|j)sx?$/, '')
  const fromParts = fromDir.split('/').filter(Boolean)
  const toParts = toNoExt.split('/').filter(Boolean)
  let common = 0
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++
  const ups = fromParts.length - common
  const rel = [...Array(ups).fill('..'), ...toParts.slice(common)].join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * Detect whether the generated app's own files (excluding builtins) reference
 * lucide-react/recharts/@stripe-js — see sandpack-preview.tsx's #1089/#1097
 * comment for why this conservative substring check is safe (a false positive
 * only costs what unconditional declaration already cost; a false negative
 * never happens because the literal package-name substring can only appear
 * via a real import).
 *
 * usesStripeJs (#1164): the ZeroCommerce checkout instruction
 * (lib/build/primitive-catalog.ts) tells Cody to render Stripe's real
 * Payment Element (loadStripe + Elements + PaymentElement) rather than a
 * hand-rolled card-number form — that import needs `@stripe/stripe-js` and
 * `@stripe/react-stripe-js` declared as Sandpack dependencies the same way
 * lucide-react/recharts already are, or the preview bundle fails to resolve
 * the import.
 *
 * usesA2UI (#126 follow-up): same gap, for the A2UI composition instruction
 * (lib/build/primitive-catalog.ts's A2UI entry) — `@ainative/ai-kit-a2ui`
 * (the renderer) and its `@ainative/ai-kit-a2ui-core` dependency are real
 * published npm packages (first published 2026-10-21) the preview bundle
 * has no reason to already know about.
 */
export function detectSandpackDependencies(sandpackFiles: Record<string, string>): {
  usesLucideReact: boolean
  usesRecharts: boolean
  usesStripeJs: boolean
  usesA2UI: boolean
} {
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))
  const generatedCode = Object.entries(sandpackFiles)
    .filter(([path]) => !builtinPaths.has(path))
    .map(([, code]) => code)
    .join('\n')
  return {
    usesLucideReact: generatedCode.includes('lucide-react'),
    usesRecharts: generatedCode.includes('recharts'),
    usesStripeJs: generatedCode.includes('@stripe/'),
    usesA2UI: generatedCode.includes('@ainative/ai-kit-a2ui'),
  }
}
