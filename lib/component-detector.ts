/**
 * ROOT COMPONENT DETECTION (builder#82).
 *
 * Given a block of extracted, single-file React component source, decide which
 * top-level component the preview runtime should render.
 *
 * Before #82 the preview route detected the root component in TWO fragile ways:
 *   - server-side: a couple of narrow regexes (`export default function Name`,
 *     `export default Name`, a leading `function Name`), defaulting to the literal
 *     string 'App' when none matched.
 *   - client-side: matching `window` globals against a HARDCODED allow-list of
 *     component names + a handful of suffixes.
 * If a generated app named its root something outside that list — or only
 * `export default`ed an anonymous / arrow / class component — detection failed and
 * the iframe showed "Component Not Found" even though the code had executed.
 *
 * This module makes detection robust and (critically) TESTABLE in isolation. The
 * priority order, most-reliable first:
 *
 *   1. IDENTIFIED default export — `export default function Foo`,
 *      `export default class Foo`, or `export default Foo` where Foo is a
 *      PascalCase name defined in the file. Render THAT regardless of its name.
 *   2. ANONYMOUS default export — `export default function() {}`,
 *      `export default () => {}`, `export default class {}`. There is no name to
 *      bind, so we synthesize one (`__PreviewDefault`) and emit a `rewrite`
 *      instruction the caller applies BEFORE stripping `export default` (otherwise
 *      the strip leaves an anonymous function *statement*, a hard syntax error).
 *   3. PascalCase top-level component that returns JSX — any top-level function /
 *      arrow-const / class whose name is PascalCase and whose body returns JSX,
 *      excluding known non-root names (icons, shadcn, AIKit, charts). The
 *      LAST-defined such component wins (root component is conventionally last).
 *   4. Known-name list — the historical hardcoded names, as a final tiebreaker.
 *
 * If none of 1–4 match, the result's `name` is null: there is genuinely no
 * renderable component and "Component Not Found" (or a parse-gate rejection) is the
 * honest outcome.
 */

/** Synthetic name bound to an anonymous default export so the runtime can find it. */
export const ANON_DEFAULT_NAME = '__PreviewDefault'

/**
 * Historical hardcoded page-component names. Kept ONLY as a last-resort tiebreaker
 * (priority 4) — never the first thing tried. NO single-word names that collide
 * with Lucide icons.
 */
export const KNOWN_PAGE_NAMES: readonly string[] = [
  'LandingPage', 'TaskFlowLanding', 'InkFlowLanding', 'ReviewBotLanding',
  'ReviewBotLandingPage', 'CodeLensLanding', 'DevPulseLanding',
  'Dashboard', 'ProjectDashboard', 'SalesDashboard', 'AgentOpsDashboard',
  'AdminDashboard', 'AnalyticsDashboard', 'MetricsDashboard',
  'AgentMonitoringDashboard', 'SocialMediaDashboard',
  'AdminPanel', 'ControlPanel',
  'EcommercePage', 'EcommerceApp', 'EcommerceSite', 'StorePage',
  'SneakerStore', 'SneakerShop', 'SneakerStorePage',
  'ShoppingApp', 'CartPage', 'ProductListingPage', 'ProductListPage',
  'BlogPage', 'BlogLayout',
  'MarketplacePage', 'AgentHubMarketplace', 'AgentHub',
  'DocsPage', 'DocumentationPage', 'ApiDocsPage',
  'GateForgeDocs', 'GateForgeApp',
  'HomePage', 'MainApp', 'PageLayout',
  'TodoList', 'TodoApp', 'ChatApp', 'ChatInterface',
  'App', 'Main', 'Component', 'Page',
]

/**
 * Names that are library / injected components, NOT the app's root — so a
 * PascalCase scan (priority 3) must skip them even though they look like
 * components. Mirrors the skip-set the client renderer already used.
 */
const NON_ROOT_NAMES = new Set<string>([
  'React', 'ReactDOM', 'Babel', 'ErrorBoundary', 'ShadcnComponents',
  'UnknownIcon', 'LucideIcon', 'FallbackIcon', 'Fragment', 'StrictMode', 'Suspense',
  // shadcn
  'Button', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent', 'CardFooter',
  'Input', 'Label', 'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback', 'Textarea',
  'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
  'Separator', 'Dialog', 'DialogOverlay', 'DialogContent', 'DialogHeader',
  'DialogTitle', 'DialogDescription', 'DialogFooter', 'Select', 'SelectTrigger',
  'SelectValue', 'SelectContent', 'SelectItem', 'Tabs', 'TabsList', 'TabsTrigger',
  'TabsContent', 'Progress', 'CircularProgress', 'Checkbox', 'RadioGroup',
  'RadioGroupItem', 'Accordion', 'AccordionItem', 'AccordionTrigger',
  'AccordionContent', 'Toast', 'ToastTitle', 'ToastDescription',
  'Alert', 'AlertTitle', 'AlertDescription', 'Popover', 'PopoverTrigger', 'PopoverContent',
  'Switch', 'Slider', 'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
  // AIKit / AINative primitives
  'StreamingIndicator', 'VideoPlayer', 'CodeDisplay', 'StreamingText',
  'ChatBubble', 'MediaGallery', 'Skeleton', 'SkeletonCard', 'MetricCard', 'EmptyState',
  'AIKitSidebar', 'AIKitHeader', 'AIKitBreadcrumb', 'AIKitPagination',
  'AIKitStepper', 'AIKitTimeline', 'AIKitTable', 'AIKitRating',
  'AIKitProductCard', 'AIKitPriceCard', 'AIKitAvatar', 'AIKitBanner',
  'AgentCard', 'SwarmView', 'AgentTimeline', 'ConnectionStatus',
  'TokenUsageBar', 'SafetyBadge', 'GuardrailPanel',
  // recharts
  'ReLineChart', 'ReBarChart', 'RePieChart', 'ResponsiveContainer',
  'XAxis', 'YAxis', 'CartesianGrid', 'RechartsTooltip', 'Legend',
  'Line', 'Bar', 'Pie', 'Cell', 'AreaChart', 'Area',
  'RadarChart', 'Radar', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
  'ComposedChart', 'Scatter', 'ScatterChart', 'RadialBarChart', 'RadialBar',
  'Treemap', 'Funnel', 'FunnelChart',
])

export interface ComponentDetection {
  /**
   * The name the runtime should render, or null when no renderable component
   * exists (→ honest "Component Not Found" / parse-gate rejection).
   */
  name: string | null
  /** How the name was resolved — for logging / debugging / tests. */
  source:
    | 'default-export-named'
    | 'default-export-anonymous'
    | 'pascalcase-jsx'
    | 'known-name'
    | 'none'
  /**
   * When set, the caller MUST apply this rewrite to the source BEFORE stripping
   * `export default` — it converts an anonymous default export into a named
   * declaration so the compiled module can bind `name`. `find` is a literal
   * substring present in the source; `replace` is the replacement.
   */
  rewrite?: { find: string; replace: string }
}

/** True if `name` is PascalCase (starts uppercase, has at least one more char). */
function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && name.length > 1
}

/**
 * True if the source between `startIdx` and the next same-name declaration (or EOF)
 * appears to RETURN JSX. Heuristic: a `return (` / `return <` followed by a JSX-ish
 * `<Tag` or a top-level `<>` fragment. Deliberately lenient — a JSX-returning
 * component is the signal; false negatives (missing a real component) are worse than
 * false positives here because priority 4 still backstops.
 */
function returnsJsx(source: string): boolean {
  // return <Tag  |  return ( ... < ...  |  => ( <  |  => <Tag
  return (
    /return\s*\(\s*</.test(source) ||
    /return\s*</.test(source) ||
    /=>\s*\(\s*</.test(source) ||
    /=>\s*</.test(source)
  )
}

/**
 * Detect the root component to render from single-file component source.
 *
 * @param rawCode extracted component source (post multi-file / markdown extraction,
 *   pre export-stripping). Imports may still be present.
 */
export function detectRootComponent(rawCode: string): ComponentDetection {
  const code = (rawCode || '').trim()
  if (!code) return { name: null, source: 'none' }

  // --- PRIORITY 1: identified default export ---------------------------------
  // export default function Foo(...)   |   export default class Foo ...
  const defFn = code.match(/export\s+default\s+function\s+([A-Z]\w*)/)
  if (defFn) return { name: defFn[1], source: 'default-export-named' }
  const defClass = code.match(/export\s+default\s+class\s+([A-Z]\w*)/)
  if (defClass) return { name: defClass[1], source: 'default-export-named' }
  // export default Foo   (bare reference to a PascalCase name — NOT a keyword)
  const defRef = code.match(/export\s+default\s+([A-Z]\w*)\s*;?/)
  if (defRef && isPascalCase(defRef[1])) {
    return { name: defRef[1], source: 'default-export-named' }
  }

  // --- PRIORITY 2: anonymous default export ----------------------------------
  // export default function() {}   |   export default function () {}
  const anonFn = code.match(/export\s+default\s+function\s*\(/)
  if (anonFn) {
    return {
      name: ANON_DEFAULT_NAME,
      source: 'default-export-anonymous',
      rewrite: {
        find: anonFn[0],
        replace: `function ${ANON_DEFAULT_NAME}(`,
      },
    }
  }
  // export default class {} / class extends X {}
  const anonClass = code.match(/export\s+default\s+class(\s+extends\s+\w+)?\s*\{/)
  if (anonClass) {
    return {
      name: ANON_DEFAULT_NAME,
      source: 'default-export-anonymous',
      rewrite: {
        find: anonClass[0],
        replace: `class ${ANON_DEFAULT_NAME}${anonClass[1] || ''} {`,
      },
    }
  }
  // export default () => ... / export default (props) => ... / export default async () =>
  const anonArrow = code.match(/export\s+default\s+(async\s+)?\([^)]*\)\s*=>/)
  if (anonArrow) {
    // Replace only the `export default ` prefix with `const __PreviewDefault = `.
    const prefix = code.match(/export\s+default\s+/)![0]
    return {
      name: ANON_DEFAULT_NAME,
      source: 'default-export-anonymous',
      rewrite: {
        find: prefix,
        replace: `const ${ANON_DEFAULT_NAME} = `,
      },
    }
  }

  // --- PRIORITY 3: PascalCase top-level component that returns JSX ------------
  // Collect every top-level function / arrow-const / class declaration with a
  // PascalCase name, in source order, then pick the LAST one that returns JSX and
  // is not a known non-root (library) name.
  const candidates: { name: string; index: number }[] = []
  const declRe =
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=|class\s+([A-Z]\w*))/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(code)) !== null) {
    const name = m[1] || m[2] || m[3]
    if (name && isPascalCase(name) && !NON_ROOT_NAMES.has(name)) {
      candidates.push({ name, index: m.index })
    }
  }
  // Prefer the last-defined candidate that returns JSX (root is conventionally last).
  for (let i = candidates.length - 1; i >= 0; i--) {
    const start = candidates[i].index
    const end = i + 1 < candidates.length ? candidates[i + 1].index : code.length
    if (returnsJsx(code.slice(start, end))) {
      return { name: candidates[i].name, source: 'pascalcase-jsx' }
    }
  }
  // No candidate demonstrably returns JSX but at least one PascalCase decl exists:
  // fall through to the known-name list, then to the last candidate as a weak guess.

  // --- PRIORITY 4: known-name tiebreaker -------------------------------------
  for (const known of KNOWN_PAGE_NAMES) {
    // Word-boundary match so we only pick names actually declared/present.
    const re = new RegExp(`(?:function\\s+|const\\s+|class\\s+)${known}\\b`)
    if (re.test(code)) return { name: known, source: 'known-name' }
  }

  // Weak final guess: any PascalCase declaration we saw (even if JSX wasn't
  // detected) is more useful than a hard failure — the runtime still wraps in an
  // ErrorBoundary. Only if there were NONE do we report "none".
  if (candidates.length > 0) {
    return { name: candidates[candidates.length - 1].name, source: 'pascalcase-jsx' }
  }

  return { name: null, source: 'none' }
}
