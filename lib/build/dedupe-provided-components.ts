/**
 * Strip a generated app's own redeclaration of a component the preview
 * scaffold already provides as a real global (shadcn/ui + AIKit component
 * names — see app/api/preview/[id]/route.ts's shadcnComponents list, which
 * this mirrors). Without this, a model that both imports AND locally
 * redefines e.g. `Button` throws "Identifier 'Button' has already been
 * declared" once the compiled app script runs alongside the setup script
 * that already declared the real one.
 *
 * Real bug found live (Dispatch, 2026-09-11, customer-reported: "basic UI
 * components are missing"): the original function-body pattern
 * (`\{[\s\S]*?\n\}`) is NOT brace-balanced — it just hunts for the FIRST
 * `\n}` after the opening brace, with no regard for nested braces in
 * between. That's fine for a genuine multi-line hand-rolled redeclaration
 * (which always has its own `\n}` before anything else), but breaks the
 * instant a SINGLE-LINE function using one of these names appears anywhere
 * earlier in the file — e.g. lib/build/flatten-multifile.ts's real
 * external-import stub, `function Card(props){ return (props &&
 * props.children) || null; }`, which has no `\n}` of its own to stop the
 * search at. Confirmed live: this consumed Dispatch's entire real
 * `function Customers() {...}` body (hundreds of lines, many genuine `\n}`
 * closes inside it) because `Card` was one of the names the flattener had
 * just stubbed a few lines earlier in the same file.
 *
 * Fixed by trying a SINGLE-LINE shape first (open and close brace on the
 * same source line — no `\n` inside at all), which can never reach past
 * its own boundary into a later function; only falling back to the
 * original multi-line pattern when the single-line shape doesn't match.
 */

export const SCAFFOLD_PROVIDED_COMPONENTS = [
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
  // Lucide icons (builder#676) — the preview scaffold pre-declares ~180 of
  // these as plain top-level `const`s in its own setup script (see
  // app/api/preview/[id]/route.ts's "Create all common icon constants"
  // block). Even though that script and the compiled app script can't read
  // each other's bindings (they're separate <script> tags), a top-level
  // `const`/`let` in EITHER one still occupies the SAME shared global
  // lexical scope — redeclaring the same identifier anywhere else throws a
  // real `SyntaxError: Identifier '...' has already been declared`, crashing
  // the whole app before it ever renders. Real bug found live (Habanero Hub,
  // 2026-09-11): the model wrote its own `const DollarSign = ({className}) =>
  // <span>$</span>` fallback (reasonable — DollarSign isn't a shadcn/AIKit
  // name) with no way to know this name was already reserved by the hidden
  // setup script, and the whole app crashed with "Identifier 'DollarSign'
  // has already been declared" before any component — and therefore no
  // primitive call — ever ran.
  'Search', 'Menu', 'X', 'ChevronDown', 'ChevronRight', 'ChevronLeft', 'ChevronUp',
  'Home', 'Settings', 'Users', 'BarChart3', 'FileText', 'Bell', 'Mail', 'Star', 'Heart',
  'ShoppingCart', 'Plus', 'Minus', 'Edit', 'Edit2', 'Pencil', 'Trash2', 'Eye', 'EyeOff',
  'Check', 'AlertCircle', 'Info', 'HelpCircle', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
  'ExternalLink', 'Download', 'Upload', 'Share2', 'Filter', 'Calendar', 'Clock', 'MapPin',
  'Phone', 'Globe', 'Lock', 'Unlock', 'Shield', 'Zap', 'TrendingUp', 'TrendingDown', 'Activity',
  'DollarSign', 'CreditCard', 'Package', 'Truck', 'Gift', 'Sun', 'Moon', 'Laptop', 'Smartphone',
  'Code', 'Terminal', 'GitBranch', 'Send', 'MessageSquare', 'MessageCircle', 'Bookmark', 'Tag',
  'Copy', 'Save', 'RefreshCw', 'MoreHorizontal', 'MoreVertical', 'Layers', 'Layout', 'Grid',
  'List', 'Target', 'Award', 'Sparkles', 'Rocket', 'Building2', 'Briefcase', 'BookOpen', 'Bot',
  'Brain', 'LogOut', 'LogIn', 'UserPlus', 'Users2', 'FolderOpen', 'File', 'Box', 'Inbox',
  'CircleDot', 'Wand2', 'Palette', 'Lightbulb', 'Newspaper', 'GraduationCap', 'Hexagon',
  'Maximize', 'Minimize', 'Maximize2', 'Minimize2', 'Play', 'Pause', 'SkipForward', 'SkipBack',
  'Volume2', 'VolumeX', 'Mic', 'MicOff', 'Camera', 'Video', 'Image', 'Music', 'Wifi', 'Cloud',
  'Database', 'Server', 'HardDrive', 'Monitor', 'Cpu', 'Github', 'Twitter', 'Linkedin',
  'Facebook', 'Instagram', 'Youtube', 'Hash', 'AtSign', 'Paperclip', 'Link', 'Clipboard',
  'Printer', 'RotateCcw', 'Move', 'Grip', 'Table2', 'Trophy', 'Flag', 'Flame', 'Brush', 'Pen',
  'Network', 'Workflow', 'Route', 'Compass', 'Navigation', 'UserMinus', 'UserCheck',
  'FolderClosed', 'FilePlus', 'FileCheck', 'FileX', 'Boxes', 'Archive', 'Circle', 'Square',
  'Triangle', 'Octagon', 'Pentagon', 'Crosshair', 'MousePointer', 'Fingerprint', 'QrCode',
  'ScanLine', 'CircuitBoard', 'Headphones', 'AlertTriangle', 'CheckCircle', 'CheckCircle2',
  'XCircle', 'MinusCircle', 'PlusCircle', 'ArrowUpRight', 'ArrowDownRight', 'ChevronFirst',
  'ChevronLast', 'Repeat', 'Shuffle', 'SlidersHorizontal', 'Cog', 'Gear',
]

/**
 * Remove any redeclaration of a scaffold-provided component name from
 * generated code, safely — never consuming past its own boundary into a
 * later, unrelated function.
 */
export function dedupeProvidedComponents(
  code: string,
  names: readonly string[] = SCAFFOLD_PROVIDED_COMPONENTS,
): string {
  let out = code.replace(/\/\/\s*Available\s+Shadcn\s+components[\s\S]*/gi, '')

  for (const comp of names) {
    // Remove const declarations like: const Button = ({ children }) => ...
    const constPattern = new RegExp(
      `const\\s+${comp}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*[\\s\\S]*?(?=\\n(?:const|function|class|let|var|$))`,
      'g',
    )
    out = out.replace(constPattern, '')

    // Remove function declarations like: function Button() { ... } — try
    // the single-line shape first (see this module's doc comment for why).
    const singleLineFuncPattern = new RegExp(`function\\s+${comp}\\s*\\([^)]*\\)\\s*\\{[^\\n{}]*\\}`, 'g')
    if (singleLineFuncPattern.test(out)) {
      out = out.replace(singleLineFuncPattern, '')
    } else {
      const funcPattern = new RegExp(`function\\s+${comp}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'g')
      out = out.replace(funcPattern, '')
    }
  }

  return out.trim()
}
