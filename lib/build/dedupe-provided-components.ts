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
  // Drifted out of sync with lib/sandpack/shadcn-bundle.ts's real exports
  // (same root-cause class as #1277/#1278/#1281/#1283/#1285) -- already
  // fixed in component-verifier.ts's AVAILABLE_COMPONENTS and
  // component-detector.ts's NON_ROOT_NAMES, but not here. Without these, a
  // generated app that both imports AND locally redefines one of these real
  // shadcn names was never deduped, so it kept the "Identifier has already
  // been declared" crash this module exists to prevent.
  'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
  'DropdownMenuLabel', 'DropdownMenuSeparator',
  'ScrollArea', 'ScrollBar', 'Slider', 'Switch', 'Textarea',
  'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
  'RadioGroup', 'RadioGroupItem', 'DialogOverlay', 'CircularProgress',
  'Toast', 'ToastTitle', 'ToastDescription',
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
/**
 * Find the index of the `)` that closes the `(` at `openIdx` (honoring
 * arbitrarily nested parens), or -1 if unbalanced.
 */
function findMatchingParen(code: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Remove every occurrence of `headRe` (a global regex that must end in the
 * literal `(` opening a parameter list) from `code`, where the text
 * immediately following the param list's TRUE closing paren matches
 * `afterParamsRe`.
 *
 * #builder (2026-10-28): all three removal patterns below used to match the
 * param list itself with a flat `\([^)]*\)`, which cannot cross a `)`
 * character INSIDE the param list — e.g. a destructured default value that
 * calls a function (`({ variant = getDefaultVariant() }) => ...`). That
 * left the redeclaration completely unmatched and therefore un-removed,
 * producing the exact "Identifier 'X' has already been declared" crash
 * this module exists to prevent. Finding the param list's real closing
 * paren by depth-counting (no regex recursion needed) fixes this for all
 * three call sites without changing behavior for any param list that
 * already worked (a flat list with no nested parens finds the same paren
 * either way).
 */
function removeBalancedParamDecl(code: string, headRe: RegExp, afterParamsRe: RegExp): string {
  let out = ''
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = headRe.exec(code))) {
    const openIdx = m.index + m[0].length - 1
    const closeIdx = findMatchingParen(code, openIdx)
    if (closeIdx === -1) continue
    const afterMatch = code.slice(closeIdx + 1).match(afterParamsRe)
    if (!afterMatch) continue
    const declEnd = closeIdx + 1 + afterMatch[0].length
    out += code.slice(lastIndex, m.index)
    lastIndex = declEnd
    headRe.lastIndex = declEnd
  }
  out += code.slice(lastIndex)
  return out
}

export function dedupeProvidedComponents(
  code: string,
  names: readonly string[] = SCAFFOLD_PROVIDED_COMPONENTS,
): string {
  let out = code.replace(/\/\/\s*Available\s+Shadcn\s+components[\s\S]*/gi, '')

  for (const comp of names) {
    // Remove const declarations like: const Button = ({ children }) => ...
    out = removeBalancedParamDecl(
      out,
      new RegExp(`const\\s+${comp}\\s*=\\s*\\(`, 'g'),
      /^\s*=>\s*[\s\S]*?(?=\n(?:const|function|class|let|var|$))/,
    )

    // Remove function declarations like: function Button() { ... } — try
    // the single-line shape first (see this module's doc comment for why).
    const singleLineRemoved = removeBalancedParamDecl(
      out,
      new RegExp(`function\\s+${comp}\\s*\\(`, 'g'),
      /^\s*\{[^\n{}]*\}/,
    )
    if (singleLineRemoved !== out) {
      out = singleLineRemoved
    } else {
      out = removeBalancedParamDecl(
        out,
        new RegExp(`function\\s+${comp}\\s*\\(`, 'g'),
        /^\s*\{[\s\S]*?\n\}/,
      )
    }
  }

  return out.trim()
}
