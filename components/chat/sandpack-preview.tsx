'use client'

import React from 'react'
import {
  SandpackProvider,
  SandpackPreview as SandpackPreviewComponent,
  SandpackLayout,
} from '@codesandbox/sandpack-react'
import { cn } from '@/lib/utils'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'
import { getBuiltinFiles } from '@/lib/sandpack/setup'

class SandpackErrorBoundary extends React.Component<
  { children: React.ReactNode; className?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className={cn('flex items-center justify-center h-full bg-red-50 dark:bg-red-950 p-6', this.props.className)}>
          <div className="text-center max-w-md">
            <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Preview failed to render</p>
            <p className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">
              {this.state.error.message?.slice(0, 300) || 'Syntax error in generated code'}
            </p>
            <button
              className="mt-4 px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

interface SandpackPreviewProps {
  files: Record<string, string>
  theme?: 'light' | 'dark'
  className?: string
}

export function SandpackPreview({ files, theme = 'light', className }: SandpackPreviewProps) {
  // Start with all built-in files (AIKit, shadcn, template)
  const sandpackFiles: Record<string, string> = { ...getBuiltinFiles() }

  // Overlay generated files on top, normalizing paths for Sandpack.
  // Sandpack's entry point is /App.tsx at the root, so we flatten /src/ paths
  // and duplicate files at multiple paths so relative imports resolve correctly.
  for (const [path, content] of Object.entries(files)) {
    // Skip non-code files (robots.txt, sitemap.xml, etc.)
    if (path.endsWith('.txt') || path.endsWith('.xml') || (path.endsWith('.json') && path.includes('well-known'))) {
      continue
    }
    sandpackFiles[path] = content

    // Duplicate /src/* files at root /* so both import styles work:
    // from './components/Foo' (when App.tsx is at /)
    // from '../components/Foo' (when importing from /src/)
    if (path.startsWith('/src/') && !path.includes('/App.tsx')) {
      const rootPath = path.replace(/^\/src\//, '/')
      sandpackFiles[rootPath] = content
    }
    // Also duplicate /app/* files at root /* for Next.js-style paths
    if (path.startsWith('/src/app/') || path.startsWith('/app/')) {
      const rootPath = path.replace(/^\/src\/app\//, '/app/').replace(/^\/app\//, '/app/')
      sandpackFiles[rootPath] = content
      // Also make page.tsx available as a direct import
      if (path.endsWith('/page.tsx') || path.endsWith('/page.ts')) {
        const dirPath = rootPath.replace(/\/page\.tsx?$/, '')
        if (dirPath !== '') {
          sandpackFiles[dirPath + '.tsx'] = content
        }
      }
    }
  }

  // Find the main component file
  const mainFile = Object.keys(sandpackFiles).find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || Object.keys(sandpackFiles).find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || Object.keys(sandpackFiles)[0]

  // Get the main component code
  let mainCode = mainFile ? sandpackFiles[mainFile] : ''

  // Rewrite relative imports that reference /src/ or /app/ paths
  // so they resolve from / (where /App.tsx lives in Sandpack)
  mainCode = mainCode.replace(
    /from\s+['"]\.\/src\//g,
    "from './"
  )
  mainCode = mainCode.replace(
    /from\s+['"]\.\/app\/page['"]/g,
    "from './app/page'"
  )

  // Inject React imports if missing — Claude often omits them
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

  // Ensure it has a default export
  if (mainCode && !mainCode.includes('export default')) {
    const match = mainCode.match(/function\s+([A-Z]\w+)/)
    if (match) {
      mainCode += `\n\nexport default ${match[1]}`
    }
  }

  // Set as /App.tsx (Sandpack's expected entry)
  sandpackFiles['/App.tsx'] = mainCode

  // Track which files are generated (not built-in) so we only fix those
  const builtinPaths = new Set(Object.keys(getBuiltinFiles()))

  // Fix syntax errors and sanitize imports in GENERATED .tsx files (not built-in AIKit/shadcn)
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (!path.endsWith('.tsx')) continue
    if (builtinPaths.has(path)) continue // Don't touch built-in files

    // Fix @/ path aliases before anything else — Sandpack doesn't support them
    let fixed = code
      .replace(/from ['"]@\/components\//g, "from './components/")
      .replace(/from ['"]@\/lib\//g, "from './lib/")
      .replace(/from ['"]@\//g, "from './")

    // Fix: sanitize broken imports and fix syntax errors
    fixed = fixJsxErrors(fixed)

    // Then: inject missing imports only if the module isn't already imported.
    // The multi-file-parser already injects most imports, so this is a safety net.
    // We check for the module source string to avoid duplicates.

    // React
    if (!fixed.includes("from 'react'") && !fixed.includes('from "react"')) {
      const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
        .filter(h => fixed.includes(h))
      if (hooks.length > 0) {
        fixed = `import React, { ${hooks.join(', ')} } from 'react'\n${fixed}`
      } else {
        fixed = `import React from 'react'\n${fixed}`
      }
    }

    // AIKit components — only inject imports for components not already imported
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
        fixed = `import { ${usedAikit.join(', ')} } from './components/aikit'\n${fixed}`
      }
    }

    // shadcn/ui components — skip any already imported
    {
      const shadcnMap: Record<string, string[]> = {
        './components/ui/button': ['Button'],
        './components/ui/card': ['Card', 'CardHeader', 'CardContent', 'CardTitle', 'CardDescription', 'CardFooter'],
        './components/ui/badge': ['Badge'],
        './components/ui/avatar': ['Avatar', 'AvatarImage', 'AvatarFallback'],
        './components/ui/input': ['Input'],
        './components/ui/tabs': ['Tabs', 'TabsList', 'TabsTrigger', 'TabsContent'],
        './components/ui/label': ['Label'],
        './components/ui/table': ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell'],
        './components/ui/separator': ['Separator'],
        './components/ui/progress': ['Progress', 'CircularProgress'],
        './components/ui/alert': ['Alert', 'AlertTitle', 'AlertDescription'],
        './components/ui/dialog': ['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter'],
        './components/ui/select': ['Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem'],
        './components/ui/checkbox': ['Checkbox', 'RadioGroup', 'RadioGroupItem'],
        './components/ui/accordion': ['Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent'],
      }
      const imports: string[] = []
      for (const [mod, components] of Object.entries(shadcnMap)) {
        const used = components.filter(c =>
          (new RegExp(`<${c}[\\s/>]|\\b${c}\\b`).test(fixed)) &&
          !new RegExp(`import\\s+.*\\b${c}\\b.*from\\s+`).test(fixed)
        )
        if (used.length > 0) {
          imports.push(`import { ${used.join(', ')} } from '${mod}'`)
        }
      }
      if (imports.length > 0) {
        fixed = imports.join('\n') + '\n' + fixed
      }
    }

    // Lucide icons
    if (!fixed.includes("from 'lucide-react'") && !fixed.includes('from "lucide-react"')) {
      const allLucideIcons = [
        'Activity', 'AlertCircle', 'AlertTriangle', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
        'Award', 'BarChart', 'BarChart2', 'BarChart3', 'Bell', 'Book', 'BookOpen', 'Bot',
        'Brain', 'Briefcase', 'Calendar', 'Camera', 'Check', 'CheckCircle', 'CheckCircle2',
        'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp', 'Circle', 'Clock', 'Cloud',
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

    sandpackFiles[path] = fixed
  }

  return (
    <div className={cn('w-full h-full flex flex-col', className)} style={{ minHeight: 0 }}>
      <SandpackErrorBoundary className="flex-1">
      <SandpackProvider
        template="react-ts"
        files={sandpackFiles}
        customSetup={{
          dependencies: {
            'lucide-react': '0.344.0',
            'recharts': '2.15.0',
            'clsx': '2.1.0',
            'tailwind-merge': '2.2.0',
          },
        }}
        options={{
          externalResources: ['https://cdn.tailwindcss.com'],
          activeFile: '/App.tsx',
        }}
        theme={theme === 'dark' ? 'dark' : 'light'}
      >
        <SandpackLayout
          style={{
            height: '100%',
            border: 'none',
            borderRadius: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SandpackPreviewComponent
            showNavigator={false}
            showRefreshButton
            showOpenInCodeSandbox={false}
            style={{ flex: 1, height: '100%' }}
          />
        </SandpackLayout>
      </SandpackProvider>
      </SandpackErrorBoundary>
    </div>
  )
}
