'use client'

import {
  SandpackProvider,
  SandpackPreview as SandpackPreviewComponent,
  SandpackLayout,
} from '@codesandbox/sandpack-react'
import { cn } from '@/lib/utils'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

interface SandpackPreviewProps {
  files: Record<string, string>
  theme?: 'light' | 'dark'
  className?: string
}

export function SandpackPreview({ files, theme = 'light', className }: SandpackPreviewProps) {
  const sandpackFiles: Record<string, string> = {}

  // Copy files, normalizing paths for Sandpack
  for (const [path, content] of Object.entries(files)) {
    // Skip non-code files (robots.txt, sitemap.xml, etc.)
    if (path.endsWith('.txt') || path.endsWith('.xml') || path.endsWith('.json') && path.includes('well-known')) {
      continue
    }
    sandpackFiles[path] = content
  }

  // Find the main component file
  const mainFile = Object.keys(sandpackFiles).find(
    f => f === '/src/App.tsx' || f === '/App.tsx'
  ) || Object.keys(sandpackFiles).find(
    f => f.endsWith('page.tsx') || f.endsWith('App.tsx')
  ) || Object.keys(sandpackFiles)[0]

  // Get the main component code
  let mainCode = mainFile ? sandpackFiles[mainFile] : ''

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

  // Fix missing imports in ALL .tsx files (App + components)
  for (const [path, code] of Object.entries(sandpackFiles)) {
    if (!path.endsWith('.tsx')) continue
    let fixed = code

    // Auto-inject React imports
    if (!fixed.includes('import React')) {
      const hooks = ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useReducer']
        .filter(h => fixed.includes(h))
      if (hooks.length > 0) {
        fixed = `import React, { ${hooks.join(', ')} } from 'react'\n${fixed}`
      } else {
        fixed = `import React from 'react'\n${fixed}`
      }
    }

    // Auto-inject AIKit component imports
    if (!fixed.includes('from \'@/components/aikit') && !fixed.includes('from "./components/aikit')) {
      const aikitComponents = [
        'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
        'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
        'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
        'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
        'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
        'AIKitStepper', 'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
      ]
      const usedAikit = aikitComponents.filter(c => new RegExp(`<${c}[\\s/>]`).test(fixed))
      if (usedAikit.length > 0) {
        fixed = `import { ${usedAikit.join(', ')} } from './components/aikit'\n${fixed}`
      }
    }

    // Auto-inject shadcn/ui component imports
    if (!fixed.includes('from \'@/components/ui') && !fixed.includes('from "./components/ui')) {
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
        const used = components.filter(c => new RegExp(`<${c}[\\s/>]|\\b${c}\\b`).test(fixed))
        if (used.length > 0) {
          imports.push(`import { ${used.join(', ')} } from '${mod}'`)
        }
      }
      if (imports.length > 0) {
        fixed = imports.join('\n') + '\n' + fixed
      }
    }

    // Auto-inject Lucide icon imports
    if (!fixed.includes('from \'lucide-react\'') && !fixed.includes('from "lucide-react"')) {
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
      const usedIcons = allLucideIcons.filter(icon => {
        // Match the icon name as a word boundary (not inside another word)
        const regex = new RegExp(`\\b${icon}\\b`)
        return regex.test(fixed)
      })
      if (usedIcons.length > 0) {
        fixed = `import { ${usedIcons.join(', ')} } from 'lucide-react'\n${fixed}`
      }
    }

    sandpackFiles[path] = fixJsxErrors(fixed)
  }

  return (
    <div className={cn('w-full h-full flex flex-col', className)} style={{ minHeight: 0 }}>
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
    </div>
  )
}
