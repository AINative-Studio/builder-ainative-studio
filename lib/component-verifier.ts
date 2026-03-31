// Component verification and replacement system for AINative UI Builder

// Available components in the preview environment
const AVAILABLE_COMPONENTS = [
  // Shadcn UI Components
  'Button',
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
  'Input', 'Label', 'Badge',
  'Avatar', 'AvatarImage', 'AvatarFallback',
  'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
  'Separator',
  'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
  'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
  'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
  'Progress', 'CircularProgress',
  'Checkbox',
  'RadioGroup', 'RadioGroupItem',
  'Toast', 'ToastTitle', 'ToastDescription',
  'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
  'Alert', 'AlertTitle', 'AlertDescription',
  'Popover', 'PopoverTrigger', 'PopoverContent',
  // Recharts (data visualization)
  'ReLineChart', 'Line', 'ReBarChart', 'Bar', 'RePieChart', 'Pie', 'Cell',
  'AreaChart', 'Area', 'RadarChart', 'Radar',
  'XAxis', 'YAxis', 'CartesianGrid', 'RechartsTooltip', 'Legend', 'ResponsiveContainer',
  'RadialBarChart', 'RadialBar', 'ComposedChart', 'Scatter', 'ScatterChart',
  // Lucide Icons (all available globally)
  'Search', 'Menu', 'X', 'ChevronDown', 'ChevronRight', 'ChevronLeft', 'ChevronUp',
  'Home', 'Settings', 'Users', 'BarChart3', 'FileText', 'Bell', 'Mail', 'Star',
  'Heart', 'ShoppingCart', 'Plus', 'Minus', 'Edit', 'Trash2', 'Eye', 'Check',
  'AlertCircle', 'Info', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  'ExternalLink', 'Download', 'Upload', 'Share2', 'Filter', 'Calendar', 'Clock',
  'MapPin', 'Phone', 'Globe', 'Lock', 'Shield', 'Zap', 'TrendingUp', 'TrendingDown',
  'Activity', 'DollarSign', 'CreditCard', 'Package', 'Truck', 'Sun', 'Moon',
  'Laptop', 'Smartphone', 'Code', 'Terminal', 'GitBranch', 'Send', 'MessageSquare',
  'Bookmark', 'Tag', 'Copy', 'Save', 'RefreshCw', 'MoreHorizontal', 'MoreVertical',
  'Layers', 'Layout', 'Grid', 'List', 'PieChart', 'LineChart', 'BarChart', 'Target',
  'Award', 'Sparkles', 'Rocket', 'Building2', 'Briefcase', 'BookOpen', 'Bot', 'Brain',
  'LogOut', 'LogIn', 'UserPlus', 'Users2', 'FolderOpen', 'File', 'Box', 'Inbox',
  'CircleDot', 'Hexagon', 'Wand2', 'Palette', 'Lightbulb',
  // AIKit / AINative Primitive Components
  'StreamingIndicator', 'VideoPlayer', 'CodeDisplay', 'StreamingText',
  'ChatBubble', 'MediaGallery', 'Skeleton', 'SkeletonCard', 'MetricCard', 'EmptyState',
  'AIKitSidebar', 'AIKitHeader', 'AIKitBreadcrumb', 'AIKitPagination',
  'AIKitStepper', 'AIKitTimeline', 'AIKitTable', 'AIKitRating',
  'AIKitProductCard', 'AIKitPriceCard', 'AIKitAvatar', 'AIKitBanner',
]

// Component replacements for truly unavailable components
const COMPONENT_REPLACEMENTS: Record<string, string> = {
  // Form components not in shadcn lite
  'Form': 'div with form styling',
  'FormItem': 'div with form item styling',
  'FormLabel': 'Label',
  'FormControl': 'div',
  'FormMessage': 'div with error styling',

  // Navigation
  'NavigationMenu': 'nav element',
  'NavigationMenuItem': 'div',
  'NavigationMenuTrigger': 'Button',
  'NavigationMenuContent': 'div',

  // Advanced components
  'AlertDialog': 'Dialog component',
  'Sheet': 'Dialog component with slide animation',

  // Data display
  'DataTable': 'Table',
  'ScrollArea': 'div with overflow-auto styling',
  'Command': 'div with command styling',
  'HoverCard': 'div with hover card styling',
}

// Extract component names from user message
export function extractComponentNames(message: string): string[] {
  const componentPatterns = [
    // Direct mentions
    /\b([A-Z][a-zA-Z]*(?:Chart|Table|Card|Button|Input|Form|Dialog|Menu|Navigation|Select|Progress|Accordion|Tab|Sheet|Alert|Command|Popover|Sidebar|Header|Footer))\b/g,
    // Generic component mentions
    /\b([A-Z][a-zA-Z]*Component)\b/g,
    // React component patterns
    /<([A-Z][a-zA-Z]*)/g
  ]

  const foundComponents = new Set<string>()

  componentPatterns.forEach(pattern => {
    const matches = message.matchAll(pattern)
    for (const match of matches) {
      foundComponents.add(match[1])
    }
  })

  return Array.from(foundComponents)
}

// Verify if components exist in our available set
export function verifyComponents(components: string[]): {
  valid: string[]
  invalid: string[]
  replacements: Record<string, string>
} {
  const valid: string[] = []
  const invalid: string[] = []
  const replacements: Record<string, string> = {}

  components.forEach(component => {
    if (AVAILABLE_COMPONENTS.includes(component)) {
      valid.push(component)
    } else {
      invalid.push(component)
      if (COMPONENT_REPLACEMENTS[component]) {
        replacements[component] = COMPONENT_REPLACEMENTS[component]
      } else {
        // Generic replacement strategy
        if (component.includes('Chart')) {
          replacements[component] = 'Card with div elements for chart visualization'
        } else if (component.includes('Form')) {
          replacements[component] = 'div with form styling'
        } else if (component.includes('Dialog') || component.includes('Modal')) {
          replacements[component] = 'div with modal styling'
        } else if (component.includes('Menu') || component.includes('Navigation')) {
          replacements[component] = 'nav element with menu styling'
        } else {
          replacements[component] = 'div with appropriate styling'
        }
      }
    }
  })

  return { valid, invalid, replacements }
}

// Generate enhanced prompt with component verification
export function enhancePromptWithVerification(
  originalMessage: string,
  verification: ReturnType<typeof verifyComponents>
): string {
  let enhancedPrompt = originalMessage

  // Add available components context
  enhancedPrompt += `\n\nIMPORTANT COMPONENT CONSTRAINTS:
Available Shadcn components: ${AVAILABLE_COMPONENTS.join(', ')}

`

  // Add replacement instructions if there are invalid components
  if (verification.invalid.length > 0) {
    enhancedPrompt += `COMPONENT REPLACEMENTS REQUIRED:
`
    Object.entries(verification.replacements).forEach(([invalid, replacement]) => {
      enhancedPrompt += `- Replace "${invalid}" with: ${replacement}\n`
    })
    enhancedPrompt += `\n`
  }

  enhancedPrompt += `GENERATION RULES:
1. Use components from the available list above, plus Lucide icons and Recharts
2. Create self-contained components with no import statements
3. Use built-in React hooks (useState, useEffect, etc.) - globally available
4. Use Tailwind CSS classes for styling with Inter font
5. Use Lucide icons for all visual indicators (not emoji or text labels)
6. Use Recharts (ReLineChart, ReBarChart, AreaChart, etc.) for data visualization
7. Make the component functional and interactive with beautiful design`

  return enhancedPrompt
}

// Main verification function to be used in the API route
export function verifyAndEnhancePrompt(message: string): {
  enhancedPrompt: string
  verification: ReturnType<typeof verifyComponents>
  extractedComponents: string[]
} {
  const extractedComponents = extractComponentNames(message)
  const verification = verifyComponents(extractedComponents)
  const enhancedPrompt = enhancePromptWithVerification(message, verification)

  return {
    enhancedPrompt,
    verification,
    extractedComponents
  }
}