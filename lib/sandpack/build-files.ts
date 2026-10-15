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
          (new RegExp(`<${c}[\\s/>]|\\b${c}\\b`).test(fixed)) &&
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

    if (!fixed.includes("from 'lucide-react'") && !fixed.includes('from "lucide-react"')) {
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
      const usedIcons = allLucideIcons.filter(icon => new RegExp(`\\b${icon}\\b`).test(fixed))
      if (usedIcons.length > 0) {
        fixed = `import { ${usedIcons.join(', ')} } from 'lucide-react'\n${fixed}`
      }
    }

    try { fixed = sanitizeForSandpack(fixed) } catch { /* keep fixed as-is */ }

    sandpackFiles[path] = fixed
  }

  return sandpackFiles
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
