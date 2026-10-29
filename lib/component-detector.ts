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
 *      `export default class Foo`, `export default Foo` where Foo is a
 *      PascalCase name defined in the file, or a renamed default via a named-
 *      export list (`export { Foo as default }`). Render THAT regardless of
 *      its name, and regardless of where else in the file it was declared.
 *   1.5. INLINE memo()/forwardRef() wrapper — `export default memo(() => {})`,
 *      `export default React.forwardRef(function Foo(...) {})`. A bare
 *      reference wrapped this way (`memo(Foo)`) needs no special handling —
 *      it falls through to priority 3's scan, which finds Foo's own
 *      declaration — but a component declared INLINE as the HOC's own call
 *      argument has no standalone declaration anywhere for any other
 *      priority to find.
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
  // Drifted out of sync with lib/sandpack/shadcn-bundle.ts's real exports
  // (same root-cause class as #1277/#1278/#1281) -- without these, a
  // generated app's own local `const DropdownMenu = ...` / `const ScrollArea
  // = ...` redeclaration (e.g. a flattener-injected external-import stub)
  // could be mistaken for the app's actual root component by priority 3's
  // PascalCase/JSX scan above.
  'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
  'DropdownMenuLabel', 'DropdownMenuSeparator', 'ScrollArea', 'ScrollBar',
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
 * Given the index of a `(` character, return the index of the `)` that
 * closes it (honoring arbitrarily nested parens), or -1 if unbalanced.
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
 * Given the index of a `<` character, return the index of the `>` that
 * closes it (honoring arbitrarily nested `<...>`), or -1 if unbalanced.
 * Mirrors findMatchingParen's depth-counting shape.
 */
function findMatchingAngleBracket(code: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === '<') depth++
    else if (code[i] === '>') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Starting right after a `const NAME` match, skip an optional TS type
 * annotation (`: Dotted.Type<...>`) honoring ARBITRARILY NESTED generics in
 * the `<...>` part — e.g. `: React.FC<{ metrics: Record<string, number> }>`.
 *
 * Returns the index of the first non-whitespace char after the annotation
 * (where a real `=` is expected), or -1 if a `:` is present but the
 * annotation is malformed (no identifier, or an unbalanced `<`).
 *
 * #1660: the annotation used to be matched inline by the same regex as the
 * rest of this function, via a flat `(?:<[^>]*>)?` group. That group has no
 * notion of nesting — `[^>]*` stops at the FIRST `>`, which for a nested
 * generic (e.g. `Record<string, number>` inside `React.FC<{...}>`) lands
 * INSIDE the outer generic, leaving a dangling `}>` that broke the `\s*=`
 * that had to follow immediately. The whole alternative then failed to
 * match at that position, making the declaration invisible to this scan —
 * if it's exported only via a named list (not `export default`) and its
 * name isn't on KNOWN_PAGE_NAMES, detection falls all the way through to
 * `{name: null, source: 'none'}`, the same "Element type is invalid" /
 * blank-page class this module's whole fix history exists to prevent.
 */
function skipArrowConstTypeAnnotation(code: string, idx: number): number {
  let i = idx
  while (i < code.length && /\s/.test(code[i])) i++
  if (code[i] !== ':') return i // no annotation at all
  i++
  while (i < code.length && /\s/.test(code[i])) i++
  const identStart = i
  while (i < code.length && /[\w.$]/.test(code[i])) i++
  if (i === identStart) return -1 // `:` with no identifier after it
  if (code[i] === '<') {
    const closeIdx = findMatchingAngleBracket(code, i)
    if (closeIdx === -1) return -1
    i = closeIdx + 1
  }
  while (i < code.length && /\s/.test(code[i])) i++
  return i
}

/**
 * True if `code` already has A default export, in EITHER form the rest of this
 * module (and the pipelines that call it) treat as authoritative:
 * `export default ...` or a renamed default via a named-export list
 * (`export { Foo as default }`).
 *
 * Several call sites that inject a synthesized `export default <Name>` when a
 * generated file is "missing" one (lib/sandpack/build-files.ts,
 * app/api/chat-ws/route.ts's truncation-recovery path) used to do their own
 * naive `code.includes('export default')` check. That literal-text check is
 * blind to the named-export-list form — real generated-code shape, not
 * contrived — so a file like:
 *
 *   function Dashboard() { ... }
 *   function Footer() { ... }
 *   export { Dashboard as default }
 *
 * was (wrongly) treated as having NO default export, and got a SECOND
 * `export default Footer` appended at the end. Two `export default`
 * statements in one module is a hard SyntaxError ("Only one default export
 * allowed per module") — strictly worse than the already-tracked "which name
 * is the real default" ambiguity (#1617), since the file no longer parses at
 * all, the exact blank-page/"Element type is invalid" crash class this
 * detector's whole fix history exists to prevent. Confirmed via a direct
 * repro through `buildSandpackFiles()` before this fix: the assembled
 * `/App.tsx` ended up with both the original `export { Dashboard as default
 * }` AND an appended `export default Footer`.
 */
export function hasDefaultExport(code: string): boolean {
  return /export\s+default\b/.test(code) || /export\s*\{[^}]*\bas\s+default\b/.test(code)
}

/**
 * True if `afterWrap` starts with an anonymous arrow function's parenthesized
 * param list immediately followed by `=>`, honoring arbitrarily nested parens
 * in the param list (e.g. a destructured default value that calls a function:
 * `({ x = getDefault() }) =>`). A flat `\([^)]*\)` scan cannot cross the `)`
 * that closes the nested call, so it was used instead of a regex here.
 */
function isAnonymousArrowWithParenParams(afterWrap: string): boolean {
  const open = afterWrap.match(/^(?:async\s+)?\(/)
  if (!open) return false
  const openIdx = open[0].length - 1
  const closeIdx = findMatchingParen(afterWrap, openIdx)
  return closeIdx !== -1 && /^\s*=>/.test(afterWrap.slice(closeIdx + 1))
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
  //
  // #1536: without the negative lookahead below, `export default
  // React.memo(Dashboard)` / `React.forwardRef(Dashboard)` greedily matched
  // just `React` (`.` isn't a `\w` char, so [A-Z]\w* stops there) and
  // isPascalCase('React') is true — this branch returned `{ name: 'React' }`
  // immediately, a confident WRONG answer (React is the imported namespace
  // object, not a component), never falling through to priority 3's real
  // PascalCase/JSX scan that would find the actual component (Dashboard).
  // The runtime then tries to render the React namespace as the root
  // component — exactly the "Element type is invalid" crash class this
  // detector exists to prevent. React.memo/forwardRef wrapping a named
  // default export is an extremely common, idiomatic pattern. The lookahead
  // rejects a captured identifier immediately followed by `.`, `(`, or `[`
  // (member access, call, or index expression) so this branch only matches a
  // genuine bare reference, letting the real case correctly fall through.
  const defRef = code.match(/export\s+default\s+([A-Z]\w*)(?![.\w(\[])\s*;?/)
  if (defRef && isPascalCase(defRef[1])) {
    return { name: defRef[1], source: 'default-export-named' }
  }

  // --- PRIORITY 1.5: component declared INLINE inside memo()/forwardRef() ----
  // export default memo(() => {...})
  // export default React.forwardRef(function Name(props, ref) {...})
  //
  // #1536 already handles memo()/forwardRef() wrapping a BARE REFERENCE to a
  // name declared elsewhere (`export default React.memo(Dashboard)`) -- that
  // case correctly falls through to priority 3's scan, which finds Dashboard's
  // own standalone declaration. But a component declared INLINE as the HOC's
  // argument -- anonymous or a named function expression -- has no standalone
  // top-level declaration anywhere for priority 1/2/3 to find. Confirmed via a
  // direct repro against this function: `export default memo(() => {...})` and
  // `export default forwardRef(function Name() {...})` both previously fell
  // through everything to `{name: null, source: 'none'}` -- the same "Element
  // type is invalid" blank-page crash class this whole detector exists to
  // prevent. (A named function expression whose name happened to be on
  // KNOWN_PAGE_NAMES was accidentally "rescued" by priority 4's tiebreaker --
  // luck, not detection, and it masks the bug for any other name.)
  const hocWrap = code.match(/export\s+default\s+((?:React\.)?(?:memo|forwardRef)\(\s*)/)
  if (hocWrap) {
    const wrapperPrefix = hocWrap[1] // e.g. "memo(" or "React.forwardRef("
    const afterWrap = code.slice(hocWrap[0].length)
    const namedFnExpr = afterWrap.match(/^(?:async\s+)?function\s+([A-Z]\w*)\s*\(/)
    if (namedFnExpr) {
      return {
        name: namedFnExpr[1],
        source: 'default-export-named',
        rewrite: {
          find: hocWrap[0],
          replace: `const ${namedFnExpr[1]} = ${wrapperPrefix}`,
        },
      }
    }
    // #1645: the arrow-with-paren-params alternative used to be a flat
    // `\([^)]*\)\s*=>` regex — same anti-pattern as #1619, but here, inside
    // the memo()/forwardRef() inline-arg check, which #1619/#1620 never
    // touched. See isAnonymousArrowWithParenParams() above.
    const isAnonymousArg =
      /^(?:async\s+)?function\s*\(/.test(afterWrap) ||
      isAnonymousArrowWithParenParams(afterWrap) ||
      /^(?:async\s+)?\w+\s*=>/.test(afterWrap)
    if (isAnonymousArg) {
      return {
        name: ANON_DEFAULT_NAME,
        source: 'default-export-anonymous',
        rewrite: {
          find: hocWrap[0],
          replace: `const ${ANON_DEFAULT_NAME} = ${wrapperPrefix}`,
        },
      }
    }
    // Neither a named nor anonymous inline declaration -- e.g. a bare
    // reference (`memo(Dashboard)`), already handled by priority 3. Fall
    // through without returning.
  }

  // Renamed default export via a named-export list — `export { Dashboard as
  // default }`, often alongside other, genuinely-non-default siblings:
  // `export { Dashboard as default, Footer }`. None of the regexes above
  // match this (they all require the literal text `export default`), so this
  // fell through entirely to priority 3's PascalCase/JSX scan, which has NO
  // way to know which declaration the export list actually marked as the
  // real default — it just picks whichever matching declaration happens to
  // be LAST in source order. A real, common generated-code shape breaks this:
  // a root component declared early, followed later in the file by another
  // PascalCase JSX-returning helper/section component (e.g. `Footer`) that
  // is never exported as default at all. Priority 3 then confidently
  // returns the wrong name — the exact "Element type is invalid" / wrong-
  // component-rendered failure this whole module exists to prevent. An
  // explicit `as default` marker is just as authoritative as a literal
  // `export default Name` and must be checked before the ambiguous
  // ordering heuristic in priority 3 ever runs.
  const exportList = code.match(/export\s*\{([^}]*)\}/)
  if (exportList) {
    for (const item of exportList[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/).map((p) => p.trim())
      if (parts.length === 2 && parts[1] === 'default' && isPascalCase(parts[0])) {
        return { name: parts[0], source: 'default-export-named' }
      }
    }
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
  // export default class {} / class extends X {} / class extends React.Component {}
  //
  // #1524: the extends-target group only allowed `\w+` — a single identifier
  // — so `export default class extends React.Component { ... }` (an
  // anonymous class component extending a DOTTED member expression, an
  // extremely common real-world shape) never matched at all. With no match,
  // detection fell through this priority entirely; for a genuinely anonymous
  // class there's no PascalCase-named declaration for priority 3 to find
  // either, so the function incorrectly returned the "no renderable
  // component" case even though a real, renderable component exists. Widened
  // to `[\w.]+` so a dotted base class matches too.
  const anonClass = code.match(/export\s+default\s+class(\s+extends\s+[\w.]+)?\s*\{/)
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
  //
  // #1619: a flat `[^)]*` scan for the param list cannot cross a `)` that
  // appears INSIDE it — e.g. a destructured default value that calls a
  // function (`({ items = getDefaultItems() }) =>`) or a nested destructure
  // with a call-expression default (`({ pair: [a, b] = getPair() }) =>`).
  // Both are real, renders-JSX anonymous default exports with no name
  // declared anywhere else for priority 3 to fall back to — the flat regex
  // simply never matched, so detection fell all the way through to `{name:
  // null}`, the same blank-page "Component Not Found" class this detector's
  // whole fix history exists to prevent. Find the arrow's true open/close
  // paren by depth-counting (handles arbitrary nesting; no regex recursion
  // needed) instead of assuming the param list is itself paren-free.
  const anonArrowStart = code.match(/export\s+default\s+(async\s+)?\(/)
  if (anonArrowStart) {
    const openIdx = anonArrowStart.index! + anonArrowStart[0].length - 1
    const closeIdx = findMatchingParen(code, openIdx)
    if (closeIdx !== -1 && /^\s*=>/.test(code.slice(closeIdx + 1))) {
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
  }

  // --- PRIORITY 3: PascalCase top-level component that returns JSX ------------
  // Collect every top-level function / arrow-const / class declaration with a
  // PascalCase name, in source order, then pick the LAST one that returns JSX and
  // is not a known non-root (library) name.
  //
  // The `const` branch originally required `=` immediately after the name
  // (`const\s+([A-Z]\w*)\s*=`), which only matches an UNTYPED arrow-const —
  // `const Dashboard = () => {...}`. A root component declared with an
  // explicit TS type annotation, e.g. `const Dashboard: React.FC<Props> =
  // () => {...}` (an extremely common LLM-codegen pattern), has a `:
  // Type<...>` clause between the name and `=` that the old regex could not
  // skip over, so the declaration was invisible to this scan entirely. When
  // that component is exported only via a bare `export { Dashboard }` list
  // (not `export default`) — so priorities 1/2 above never fire — detection
  // fell all the way through to `{name: null, source: 'none'}`, the same
  // "Component Not Found" / "Element type is invalid" outcome the rest of
  // this module's fix history (#1523/#1536/#1524) exists to prevent. The
  // optional annotation (a dotted/generic type name, e.g. `React.FC<Props>`,
  // `FC`, `Component<P, S>`) between the name and `=` is tolerated via
  // skipArrowConstTypeAnnotation (#1660) rather than inline in this regex —
  // see that helper's doc comment for why a flat `<[^>]*>` group couldn't
  // handle a NESTED generic (e.g. `React.FC<{ metrics: Record<string,
  // number> }>`). The const alternative below only matches up through the
  // name; the `=` itself (and anything typed between it and the name) is
  // verified manually below, same as the regex used to require inline
  // (without needing `[^=]+`, which would wrongly swallow a real `=` inside
  // an arrow-type annotation like `: () => void`).
  const candidates: { name: string; index: number }[] = []
  const declRe =
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)|class\s+([A-Z]\w*))/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(code)) !== null) {
    const name = m[1] || m[2] || m[3]
    if (!name || !isPascalCase(name) || NON_ROOT_NAMES.has(name)) continue
    if (m[2]) {
      // const branch: the name must actually be followed by (an optional
      // type annotation, then) a real assignment `=` — not `==`/`=>` — or
      // this isn't an arrow-const declaration at all.
      const afterName = m.index + m[0].length
      const afterAnnotation = skipArrowConstTypeAnnotation(code, afterName)
      if (
        afterAnnotation === -1 ||
        code[afterAnnotation] !== '=' ||
        code[afterAnnotation + 1] === '=' ||
        code[afterAnnotation + 1] === '>'
      ) {
        continue
      }
    }
    candidates.push({ name, index: m.index })
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
