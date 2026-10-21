/**
 * Attempts to fix common JSX syntax errors from AI-generated code.
 * Not perfect, but catches the most frequent issues.
 */

export function fixJsxErrors(code: string): string {
  let fixed = code

  // Fix 0: Rewrite @/ path aliases — Sandpack doesn't support tsconfig path aliases
  fixed = fixed.replace(/from ['"]@\/components\//g, "from './components/")
  fixed = fixed.replace(/from ['"]@\/lib\//g, "from './lib/")
  fixed = fixed.replace(/from ['"]@\//g, "from './")

  // Fix 0b: Rewrite barrel imports that Sandpack can't resolve
  fixed = rewriteBarrelImports(fixed)

  // Fix 0b2: Route shadcn components imported from the WRONG ui/* file to the
  // correct one. The model routinely does `import { Card, Badge, Progress } from
  // './components/ui/button'` — but button.tsx only exports Button, so Card etc.
  // are undefined → "Element type is invalid" / Sandpack "Something went wrong".
  fixed = fixWrongShadcnSubpaths(fixed)

  // Fix 0c: Rewrite hallucinated package names to known equivalents
  fixed = rewriteHallucinatedPackages(fixed)

  // Fix 0c2: Stub next/image and next/link — real Next.js modules that don't
  // exist in Sandpack's plain react-ts template (see #1151)
  fixed = stubNextOnlyImports(fixed)

  // Fix 0c3: Stub icon libraries Sandpack's customSetup never declares as a
  // dependency (#1099 item 7). Only react-icons is pinned here because it's
  // the one real instance confirmed live; a bare substring check for other
  // unknown packages would be too broad to apply safely without its own repro.
  fixed = stubUnsupportedIconLibraries(fixed)

  // Fix 0c4: Fix a malformed `import type, { X } from 'Y'` the model itself
  // writes (#1099 item 6) -- a stray comma after `type` that should be a
  // space, i.e. `import type { X } from 'Y'`. Confirmed live: this is
  // upstream of any missing/wrong-path import (sanitizeImports/injection
  // below never touch it, since the statement already "has" its braces).
  fixed = fixMalformedTypeImport(fixed)

  // Fix 0d: Sanitize broken/overlapping imports (most common AI generation error)
  fixed = sanitizeImports(fixed)

  // Fix 0e: Stub remaining Next.js-only module specifiers that can appear in
  // an ordinary generated file (next/navigation, next/font/google|local,
  // next/dynamic, next/script) — see #1154.
  fixed = stubNextOnlyModules(fixed)

  // Fix 0f: Stub legacy Pages Router module specifiers (next/router, next/head,
  // next/document, next/app) that carry the same whole-compile-crash risk as
  // next/image/next/link — see #1174.
  fixed = stubLegacyPagesRouterImports(fixed)

  // Fix 0g: Stub framer-motion — same whole-compile-crash risk as next/image
  // et al. (#1151/#1154/#1174): it is not declared as a Sandpack dependency
  // (see components/chat/sandpack-preview.tsx's customSetup.dependencies),
  // so any unresolvable import anywhere crashes the entire compile. The
  // llmSystemPrompt already forbids it, but prompt-level bans alone have
  // already proven insufficient for this exact failure mode — see #1174.
  fixed = stubFramerMotionImports(fixed)

  // Fix 0h: Generic safety net for ANY remaining bare import of a package
  // Sandpack doesn't actually have available (see
  // components/chat/sandpack-preview.tsx's customSetup.dependencies for the
  // real allowlist). Sandpack's bundler fails the ENTIRE compile on any
  // unresolvable import anywhere in the file tree, regardless of whether
  // it's reachable (confirmed mechanism, #1124/#1125) — the generation
  // model can reach for any common React-ecosystem package not on that
  // allowlist (date-fns, zod, axios, uuid, react-hook-form, framer-motion,
  // react-icons, next/*, styled-components, etc.), and each one is equally
  // capable of crashing the whole preview. Rather than hand-writing a new
  // named stub per package every time one is discovered (#1179), this runs
  // LAST so any more precise, package-specific stub already added above
  // (or landed in a future fix) still wins — this only catches whatever's
  // left over.
  fixed = stubUnresolvableBareImports(fixed)

  // Fix 0g: Same safety net, for the re-export shapes (`export {...} from
  // 'pkg'`, `export * from 'pkg'`) that Fix 0f's import-only regexes never
  // match (#1181) — Sandpack resolves the specifier on a re-export exactly
  // like a plain import, so it carries the identical whole-compile-crash
  // risk.
  fixed = stubUnresolvableReExports(fixed)

  // Fix 1: DISABLED — balanceJsxTags adds closing tags in wrong context
  // causing "Unexpected token, expected ','" errors in Sandpack
  // fixed = balanceJsxTags(fixed)

  // Fix 2: Remove trailing content after the component (like stray backticks, markdown)
  fixed = removeTrailingNoise(fixed)

  // Fix 3: Fix common syntax issues
  fixed = fixCommonSyntax(fixed)

  return fixed
}

/**
 * Stub remaining Next.js-only module specifiers that can appear in an
 * ordinary generated file (not just an excluded App Router convention file
 * — see build-files.ts's basename exclusion, which only covers whole files
 * like layout.tsx, not an ordinary component that happens to import one of
 * these). Sandpack's preview sandbox is a plain react-ts template with no
 * `next` dependency at all (components/chat/sandpack-preview.tsx's
 * customSetup.dependencies never declares it, deliberately — adding it
 * would reopen the unpkg-resolution-hang risk that file's own comment
 * documents), so any of these fails the WHOLE compile with "Cannot find
 * module" the same way next/image/next/link do (#1151): sandpack-bundler's
 * collectAppBarrelUsage resolves every provided file's imports regardless
 * of reachability, so one unresolvable specifier anywhere silently fails
 * the entire compile with no error surfaced to the host page. Mirrors the
 * existing stub-to-inert philosophy used elsewhere in this pipeline
 * (build-files.ts's stubMissingLocalComponents, the react-icons stub below)
 * rather than guessing at real behavior. See #1154.
 */
function stubNextOnlyModules(code: string): string {
  let fixed = code

  // next/navigation — client-side routing hooks/helpers.
  fixed = fixed.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]next\/navigation['"]\s*;?/g,
    (_match, names: string) => stubNamedImports(names, (name) => NEXT_NAVIGATION_STUBS[name]),
  )

  // next/font/google, next/font/local — font factory functions; generated
  // code only ever reads `.className`/`.style`/`.variable` off the result.
  fixed = fixed.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]next\/font\/(?:google|local)['"]\s*;?/g,
    (_match, names: string) => stubNamedImports(names, () => FONT_FACTORY_STUB),
  )

  // next/dynamic — default import, e.g. `import dynamic from 'next/dynamic'`.
  // Dropping lazy-loading for an inert placeholder avoids both the
  // missing-module crash and a React.lazy-without-Suspense crash.
  fixed = fixed.replace(
    /import\s+(\w+)\s+from\s+['"]next\/dynamic['"]\s*;?/g,
    (_match, name: string) => `const ${name} = (..._args) => () => null;`,
  )

  // next/script — default import, e.g. `import Script from 'next/script'`.
  fixed = fixed.replace(
    /import\s+(\w+)\s+from\s+['"]next\/script['"]\s*;?/g,
    (_match, name: string) => `const ${name} = (_props) => null;`,
  )

  return fixed
}

/**
 * Stub legacy Pages Router module specifiers (next/router, next/head,
 * next/document, next/app) the same way #1151/#1154's fixes stub App
 * Router-only imports: none of these modules exist in Sandpack's plain
 * react-ts template (no `next` dependency is ever declared — see
 * components/chat/sandpack-preview.tsx's customSetup.dependencies), and an
 * unresolvable import anywhere in the generated files silently fails
 * sandpack-bundler's whole-app compile regardless of whether that file is
 * reachable from the real entry point (collectAppBarrelUsage resolves every
 * provided file's imports up front). The generation model is trained on a
 * mix of App Router and the older Pages Router convention, so it reaches
 * for these just as often as the App Router APIs already covered. See #1174.
 */
function stubLegacyPagesRouterImports(code: string): string {
  let fixed = code

  // next/router — Pages Router's useRouter() has a different shape than
  // next/navigation's: callers read static fields (pathname/query/asPath)
  // directly off the hook result rather than calling separate hooks.
  fixed = fixed.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]next\/router['"]\s*;?/g,
    (_match, names: string) => stubNamedImportsAs(names, { useRouter: NEXT_ROUTER_STUB })
  )
  // Rare default/namespace usage of the deprecated `Router` singleton.
  fixed = fixed.replace(
    /import\s+Router\s+from\s+['"]next\/router['"]\s*;?/g,
    `const Router = ${NEXT_ROUTER_STUB};`
  )

  // next/head — default-imported per-page <Head> component, used only for
  // side-effect-free <title>/<meta> tags with no equivalent in a Sandpack
  // iframe preview.
  fixed = fixed.replace(
    /import\s+(\w+)\s+from\s+['"]next\/head['"]\s*;?/g,
    (_match, name: string) => `const ${name} = (_props: any) => null;`
  )

  // next/document — only ever imported from a _document.tsx, which Sandpack
  // never treats as the preview's entry point, but stub for completeness
  // rather than leaving a guaranteed "Cannot find module" if one somehow
  // ends up in the files map.
  fixed = fixed.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]next\/document['"]\s*;?/g,
    (_match, names: string) =>
      stubNamedImportsAs(names, {
        Html: '(props: any) => props.children ?? null',
        Main: '() => null',
        Head: '(_props: any) => null',
        NextScript: '() => null',
      })
  )

  // next/app — AppProps is a type-only import; dropping it leaves a dangling
  // type reference, which Sandpack's transpile-only bundler strips rather
  // than type-checks, so it compiles fine without a stub (same risk-free
  // handling as #1150's type-import fix for a different malformed shape).
  fixed = fixed.replace(/import\s+(?:type\s+)?\{\s*AppProps\s*\}\s+from\s+['"]next\/app['"]\s*;?\n?/g, '')

  return fixed
}

const NEXT_NAVIGATION_STUBS: Record<string, string> = {
  useRouter: "() => ({ push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} })",
  usePathname: "() => '/'",
  useSearchParams: "() => new URLSearchParams()",
  useParams: '() => ({})',
  useSelectedLayoutSegment: '() => null',
  useSelectedLayoutSegments: '() => []',
  redirect: '() => {}',
  permanentRedirect: '() => {}',
  notFound: '() => {}',
}

const FONT_FACTORY_STUB = "(..._args) => ({ className: '', style: {}, variable: '' })"

const NEXT_ROUTER_STUB =
  "() => ({ push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, reload: () => {}, prefetch: () => Promise.resolve(), pathname: '/', asPath: '/', route: '/', query: {}, isReady: true, events: { on: () => {}, off: () => {}, emit: () => {} } })"

/**
 * Stub framer-motion's named exports with inert passthroughs. `motion.<tag>`
 * is a Proxy that drops animation-only props (initial, animate, exit,
 * transition, variants, the while-prefixed gesture props, the drag-prefixed
 * props, layout, layoutId) and renders the plain tag with the rest, so a
 * generated `<motion.div whileHover={{...}}>` still renders its children,
 * just without the animation — unstyled-but-present is strictly better than
 * crashing the whole preview (same philosophy as the next-module stubs and
 * #1150's react-icons stub).
 */
function stubFramerMotionImports(code: string): string {
  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]framer-motion['"]\s*;?/g,
    (_match, names: string) => stubNamedImportsAs(names, FRAMER_MOTION_STUBS)
  )
}

const FRAMER_MOTION_STUBS: Record<string, string> = {
  motion:
    "new Proxy({}, { get: (_t: any, tag: any) => ({ children, initial, animate, exit, transition, variants, whileHover, whileTap, whileInView, whileFocus, whileDrag, viewport, layout, layoutId, drag, dragConstraints, dragElastic, dragSnapToOrigin, dragMomentum, onAnimationComplete, custom, ...rest }: any) => { const Tag = tag as any; return <Tag {...rest}>{children}</Tag> } })",
  AnimatePresence: '(props: any) => props.children ?? null',
  LazyMotion: '(props: any) => props.children ?? null',
  MotionConfig: '(props: any) => props.children ?? null',
  useAnimation: '() => ({ start: () => Promise.resolve(), stop: () => {}, set: () => {} })',
  useMotionValue: '(v: any) => ({ get: () => v, set: () => {}, onChange: () => () => {} })',
  useSpring: '(v: any) => ({ get: () => v, set: () => {}, onChange: () => () => {} })',
  useTransform: '(_v: any, _i: any, output: any) => ({ get: () => Array.isArray(output) ? output[0] : output })',
}

/**
 * Rewrite a named-import clause (`Foo, Bar as Baz`) into `const` declarations
 * using a per-name stub expression. A name with no known stub is dropped from
 * the output entirely rather than guessed at — leaving it unresolved is no
 * worse than before, and never risks a wrong behavior silently compiling.
 */
function stubNamedImports(names: string, stubFor: (name: string) => string | undefined): string {
  const parts = names.split(',').map((n) => n.trim()).filter(Boolean)
  const lines: string[] = []
  for (const raw of parts) {
    const [sourceName, aliasName] = raw.split(/\s+as\s+/).map((s) => s.trim())
    const stub = stubFor(sourceName)
    if (!stub) continue
    lines.push(`const ${aliasName || sourceName} = ${stub};`)
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}

/**
 * Same as stubNamedImports, but looks up each stub from a plain
 * Record<string,string> instead of a callback — the shape
 * stubLegacyPagesRouterImports' call sites use (#1174).
 */
function stubNamedImportsAs(names: string, stubs: Record<string, string>): string {
  return stubNamedImports(names, (name) => stubs[name])
}

/**
 * Map each shadcn component to the ui/* file that actually exports it, so a
 * component imported from the wrong subpath can be re-routed.
 */
const SHADCN_COMPONENT_FILE: Record<string, string> = {
  Button: 'button',
  Card: 'card', CardHeader: 'card', CardContent: 'card', CardTitle: 'card', CardDescription: 'card', CardFooter: 'card',
  Badge: 'badge',
  Avatar: 'avatar', AvatarImage: 'avatar', AvatarFallback: 'avatar',
  Tabs: 'tabs', TabsList: 'tabs', TabsTrigger: 'tabs', TabsContent: 'tabs',
  Label: 'label',
  Table: 'table', TableHeader: 'table', TableBody: 'table', TableRow: 'table', TableHead: 'table', TableCell: 'table',
  Separator: 'separator',
  Dialog: 'dialog', DialogOverlay: 'dialog', DialogContent: 'dialog', DialogHeader: 'dialog', DialogTitle: 'dialog', DialogDescription: 'dialog', DialogFooter: 'dialog',
  Select: 'select', SelectTrigger: 'select', SelectValue: 'select', SelectContent: 'select', SelectItem: 'select',
  Progress: 'progress', CircularProgress: 'progress',
  Checkbox: 'checkbox', RadioGroup: 'checkbox', RadioGroupItem: 'checkbox',
  Accordion: 'accordion', AccordionItem: 'accordion', AccordionTrigger: 'accordion', AccordionContent: 'accordion',
  Alert: 'alert', AlertTitle: 'alert', AlertDescription: 'alert',
  Popover: 'popover', PopoverTrigger: 'popover', PopoverContent: 'popover',
  Switch: 'switch', Textarea: 'textarea', Slider: 'slider',
  Tooltip: 'tooltip', TooltipProvider: 'tooltip', TooltipTrigger: 'tooltip', TooltipContent: 'tooltip',
  Skeleton: 'skeleton',
}

/**
 * Re-route shadcn components imported from the wrong ./components/ui/<file>.
 * Splits a mis-targeted import into per-file imports so every component resolves.
 * Only touches names we know are shadcn; anything else stays on the original path.
 */
function fixWrongShadcnSubpaths(code: string): string {
  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"](\.\.?\/components\/ui)\/([a-z-]+)['"]\s*;?/g,
    (match, names: string, base: string, file: string) => {
      const parts = names.split(',').map((n) => n.trim()).filter(Boolean)
      // Group each imported name by the file that actually exports it.
      const byFile: Record<string, string[]> = {}
      const keepOnOriginal: string[] = []
      for (const raw of parts) {
        const name = raw.split(/\s+as\s+/)[0].trim()
        const correct = SHADCN_COMPONENT_FILE[name]
        if (correct) (byFile[correct] ||= []).push(raw)
        else keepOnOriginal.push(raw) // unknown — leave where it was
      }
      // If everything already targets the correct file, no change.
      const files = Object.keys(byFile)
      if (files.length === 0 || (files.length === 1 && files[0] === file && keepOnOriginal.length === 0)) {
        return match
      }
      const lines: string[] = []
      for (const f of files) lines.push(`import { ${byFile[f].join(', ')} } from '${base}/${f}';`)
      if (keepOnOriginal.length > 0) lines.push(`import { ${keepOnOriginal.join(', ')} } from '${base}/${file}';`)
      // Trailing newline so an adjacent import on the next source line doesn't
      // concatenate onto ours (which would be a parse error).
      return lines.join('\n') + '\n'
    },
  )
}

/**
 * Attempt to balance mismatched JSX tags.
 * Tracks open/close tags and inserts missing closing tags.
 */
function balanceJsxTags(code: string): string {
  // Track ALL JSX tags (both HTML lowercase and React PascalCase)
  // to catch unclosed <div>, <section>, <main>, etc.

  const lines = code.split('\n')
  const tagStack: string[] = []
  const result: string[] = []

  // Void HTML elements that don't need closing tags
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Find opening JSX tags — both <div ...> and <CardContent ...>
    const openTags = line.matchAll(/<([a-zA-Z][A-Za-z0-9]*)(?:\s[^>]*)?(?<!\/)\s*>/g)
    for (const match of openTags) {
      if (!voidElements.has(match[1].toLowerCase())) {
        tagStack.push(match[1])
      }
    }

    // Find self-closing tags — don't add to stack
    const selfClosing = line.matchAll(/<([a-zA-Z][A-Za-z0-9]*)(?:\s[^>]*)?\s*\/>/g)
    for (const _match of selfClosing) {
      // These are fine, no stack change
    }

    // Find closing tags
    const closeTags = line.matchAll(/<\/([a-zA-Z][A-Za-z0-9]*)\s*>/g)
    for (const match of closeTags) {
      const closeTag = match[1]
      const lastOpen = tagStack[tagStack.length - 1]

      if (lastOpen === closeTag) {
        // Perfect match
        tagStack.pop()
      } else if (tagStack.includes(closeTag)) {
        // Mismatched — insert closing tags for everything between
        const insertTags: string[] = []
        while (tagStack.length > 0 && tagStack[tagStack.length - 1] !== closeTag) {
          insertTags.push(`</${tagStack.pop()}>`)
        }
        if (tagStack.length > 0) {
          tagStack.pop() // pop the matching tag
        }
        // Insert the missing closing tags before this line
        if (insertTags.length > 0) {
          result.push(insertTags.join('\n'))
        }
      }
    }

    result.push(line)
  }

  // Close any remaining open tags at the end
  while (tagStack.length > 0) {
    result.push(`</${tagStack.pop()}>`)
  }

  return result.join('\n')
}

/**
 * Remove trailing markdown/noise after the component code.
 */
function removeTrailingNoise(code: string): string {
  // Remove trailing ``` or markdown that Claude sometimes appends
  let fixed = code.replace(/```\s*$/, '')

  // Remove lines after "export default" that look like markdown
  const lines = fixed.split('\n')
  let lastCodeLine = lines.length - 1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('```') || line.startsWith('---') || line.startsWith('##') || line.startsWith('Note:')) {
      lastCodeLine = i - 1
    } else if (line.length > 0) {
      break
    }
  }

  return lines.slice(0, lastCodeLine + 1).join('\n')
}

/**
 * Fix common syntax errors in AI-generated code.
 */
function fixCommonSyntax(code: string): string {
  let fixed = code

  // Fix: const x = (; → const x = (
  fixed = fixed.replace(/=\s*\(\s*;/g, '= (')

  // Fix: useMemo(() => ; → useMemo(() =>
  fixed = fixed.replace(/=>\s*;/g, '=>')

  // Fix: double semicolons
  fixed = fixed.replace(/;;\s*$/gm, ';')

  // Fix: window.X = X; at end (from old preview system)
  fixed = fixed.replace(/^window\.[A-Z]\w+\s*=\s*[A-Z]\w+;?\s*$/gm, '')

  // Fix: Expose components to window comment (from old preview system)
  fixed = fixed.replace(/^\/\/\s*Expose components to window.*$/gm, '')

  // Bracket balancing disabled — causes more Sandpack errors than it fixes

  return fixed
}

/**
 * Rewrite barrel imports that Sandpack can't resolve.
 * AI often generates `import { X, Y } from './components'` or `from '../components'`
 * which assumes a barrel file (index.ts) that doesn't exist in Sandpack.
 * We rewrite these to import from the known AIKit/shadcn/lucide sources.
 */
function rewriteBarrelImports(code: string): string {
  // Match imports from bare './components' or '../components' (no subpath)
  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]\.\.?\/components['"]\s*;?/g,
    (_match, names: string) => {
      const components = names.split(',').map((n: string) => n.trim()).filter(Boolean)

      // Known AIKit components
      const aikitNames = new Set([
        'MetricCard', 'AIKitPriceCard', 'AIKitRating', 'AgentCard', 'SwarmView',
        'SafetyBadge', 'GuardrailPanel', 'ChatBubble', 'StreamingIndicator', 'CodeDisplay',
        'TokenUsageBar', 'ConnectionStatus', 'AIKitHeader', 'AIKitSidebar', 'AIKitTable',
        'AIKitTimeline', 'AIKitBanner', 'AIKitAvatar', 'Skeleton', 'SkeletonCard',
        'EmptyState', 'AIKitProductCard', 'AIKitPagination', 'AIKitBreadcrumb',
        'AIKitStepper', 'VideoPlayer', 'StreamingText', 'MediaGallery', 'AgentTimeline',
      ])
      // Known shadcn components
      const shadcnNames = new Set([
        'Button', 'Card', 'CardHeader', 'CardContent', 'CardTitle', 'CardDescription', 'CardFooter',
        'Badge', 'Avatar', 'AvatarImage', 'AvatarFallback', 'Input', 'Label',
        'Tabs', 'TabsList', 'TabsTrigger', 'TabsContent',
        'Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell',
        'Separator', 'Progress', 'CircularProgress',
        'Alert', 'AlertTitle', 'AlertDescription',
        'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter',
        'Select', 'SelectTrigger', 'SelectValue', 'SelectContent', 'SelectItem',
        'Checkbox', 'RadioGroup', 'RadioGroupItem',
        'Accordion', 'AccordionItem', 'AccordionTrigger', 'AccordionContent',
      ])
      // Known recharts components
      const rechartsNames = new Set([
        'ResponsiveContainer', 'LineChart', 'Line', 'BarChart', 'Bar', 'PieChart', 'Pie', 'Cell',
        'AreaChart', 'Area', 'RadarChart', 'Radar', 'RadialBarChart', 'RadialBar',
        'ComposedChart', 'Scatter', 'ScatterChart', 'XAxis', 'YAxis', 'CartesianGrid',
        'Tooltip', 'Legend', 'PolarGrid', 'PolarAngleAxis', 'PolarRadiusAxis',
      ])

      const aikit: string[] = []
      const shadcn: string[] = []
      const recharts: string[] = []
      const unknown: string[] = []

      for (const c of components) {
        if (aikitNames.has(c)) aikit.push(c)
        else if (shadcnNames.has(c)) shadcn.push(c)
        else if (rechartsNames.has(c)) recharts.push(c)
        else unknown.push(c)
      }

      const imports: string[] = []
      if (aikit.length > 0) imports.push(`import { ${aikit.join(', ')} } from './components/aikit'`)
      if (shadcn.length > 0) imports.push(`import { ${shadcn.join(', ')} } from './components/ui/card'`)
      if (recharts.length > 0) imports.push(`import { ${recharts.join(', ')} } from 'recharts'`)
      // Unknown components — still import from aikit as best guess
      if (unknown.length > 0) imports.push(`import { ${unknown.join(', ')} } from './components/aikit'`)

      return imports.join('\n')
    }
  )
}

/**
 * Rewrite hallucinated package names to known Sandpack-available equivalents.
 * Only targets packages that are clearly invented/non-existent (e.g. 'AINativePrimitives').
 * Real packages like 'aikit', '@ainative/react-sdk', etc. are preserved.
 */
function rewriteHallucinatedPackages(code: string): string {
  // Rewrite packages that are clearly hallucinated bare CamelCase names.
  // Rule: bare (unscoped, no slashes) package names that start with AINative or AIKit
  // are fake — real packages are either scoped (@ainative/*) or lowercase ('aikit').
  // Real packages PRESERVED: '@ainative/react-sdk', '@ainative/next-sdk', 'aikit', etc.
  return code.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([A-Za-z][\w]*)['"](\s*;?)/g,
    (match, names: string, pkg: string, semi: string) => {
      // Bare CamelCase names starting with AINative or AIKit = hallucinated
      const isHallucinated = /^(AINative|AIKit|AiNative|AiKit)[A-Z]?\w*$/.test(pkg)
      if (!isHallucinated) return match
      const components = names.split(',').map((n: string) => n.trim()).filter(Boolean)
      return `import { ${components.join(', ')} } from './components/aikit'${semi}`
    }
  )
}

/**
 * Stub next/image and next/link imports with inline local passthrough
 * components (#1151). The real deployed app target is Next.js
 * (lib/build/company-scaffold.ts's Dockerfile uses .next/standalone), so the
 * generation model has every reason to reach for <Image>/<Link> in ordinary
 * hero/nav components — not just the already-excluded App Router convention
 * files (layout.tsx etc, #1124/#1136/#1143). Sandpack's preview is a plain
 * react-ts template with no `next` dependency at all
 * (components/chat/sandpack-preview.tsx's customSetup.dependencies never
 * declares it, deliberately — adding it as a real dependency would reopen
 * the unpkg-resolution-hang risk that file's own comment documents), so an
 * unresolvable next/image or next/link specifier in ANY generated file
 * silently fails sandpack-bundler's whole-app compile (same
 * collectAppBarrelUsage mechanism as #1124/#1125), not just the one file
 * that used it.
 *
 * Mirrors #1099 item 7 / PR #1150's react-icons stub philosophy, but inline
 * per-file (a local `const Image = ...` right where the import was) instead
 * of pointing at a shared builtin file — avoids re-deriving this file's
 * relative-depth-from-root the way the shadcn/AIKit injections in
 * build-files.ts have to. A real <img>/<a> is a faithful enough stand-in for
 * a preview: next/image-only props (fill, priority, quality, placeholder,
 * sizes, loader) are dropped since they're not valid DOM attributes on a
 * plain <img>; next/image's optional static-import src shape ({ src: '...' })
 * is unwrapped to a plain string.
 */
function stubNextOnlyImports(code: string): string {
  let fixed = code

  const imageImport = /import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]next\/image['"]\s*;?\n?/
  const imageMatch = fixed.match(imageImport)
  if (imageMatch) {
    const name = imageMatch[1]
    fixed = fixed.replace(
      imageImport,
      `const ${name} = ({ src, alt, fill, priority, quality, placeholder, loader, sizes, ...rest }: any) => <img src={typeof src === 'object' && src !== null ? src.src : src} alt={alt || ''} {...rest} />\n`
    )
  }

  const linkImport = /import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]next\/link['"]\s*;?\n?/
  const linkMatch = fixed.match(linkImport)
  if (linkMatch) {
    const name = linkMatch[1]
    fixed = fixed.replace(
      linkImport,
      `const ${name} = ({ href, children, prefetch, replace, scroll, ...rest }: any) => <a href={href} {...rest}>{children}</a>\n`
    )
  }

  return fixed
}

/**
 * Replace a `react-icons/*` import with inline inert stub components.
 *
 * Real bug (confirmed live via #1099 item 7): the model sometimes reaches
 * for react-icons (e.g. `import { FaRegCircle } from 'react-icons/fa'`)
 * instead of the one icon library this preview actually supports
 * (lucide-react, pinned in sandpack-preview.tsx's customSetup.dependencies).
 * react-icons is never declared there, so Sandpack's bundler fails the
 * WHOLE compile with "Cannot find module" for an icon used in one small
 * spot. Mirrors stubMissingLocalComponents' philosophy in build-files.ts:
 * degrade the one icon to rendering nothing rather than crash the preview.
 * Declaring react-icons as a real dependency instead was deliberately not
 * done here — this preview already pins exact dependency versions to avoid
 * Sandpack/unpkg resolution hangs (see sandpack-preview.tsx's comment on
 * why react/react-dom/prop-types are pinned), and adding an unpinned,
 * previously-unused package would reopen exactly that risk for a library
 * only ever seen as a model mistake, not an intentional choice.
 */
function stubUnsupportedIconLibraries(code: string): string {
  return code.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]react-icons\/[\w-]+['"]\s*;?/g,
    (match, names: string) => {
      const identifiers = names
        .split(',')
        .map((n: string) => n.trim())
        .filter(Boolean)
        .map((n: string) => {
          const asMatch = n.match(/^(\S+)\s+as\s+(\S+)$/)
          return asMatch ? asMatch[2] : n
        })
        .filter((n: string) => /^[A-Za-z_$][\w$]*$/.test(n))
      if (identifiers.length === 0) return match
      return identifiers
        .map((id: string) => `const ${id} = (_props: any) => null // Auto-stubbed: react-icons is not supported in the preview sandbox (#1099)`)
        .join('\n')
    }
  )
}

/**
 * Fix a malformed `import type, { X } from 'Y'` the model writes (#1099
 * item 6, confirmed live) -- a stray comma where a space belongs, producing
 * invalid TS syntax (`Unexpected token`). Only touches this exact shape;
 * a real `import Foo, { Bar } from 'baz'` (default + named) is untouched
 * since it never has the literal word `type` right after `import`.
 */
function fixMalformedTypeImport(code: string): string {
  return code.replace(/\bimport\s+type\s*,\s*\{/g, 'import type {')
}

/**
 * Sanitize broken/overlapping import statements.
 * AI models sometimes generate incomplete imports (unclosed braces)
 * followed by another import, producing invalid syntax like:
 *   import {
 *   import { Foo } from 'bar'
 *     Button,
 *     Card,
 * This function detects and fixes these patterns.
 */
function sanitizeImports(code: string): string {
  const lines = code.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect an import that opens a brace but never closes it on this line
    if (/^import\s+\{[^}]*$/.test(trimmed)) {
      // Look ahead: does the next non-empty line start with another import?
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++

      if (j < lines.length && /^import\s+/.test(lines[j].trim())) {
        // This is a broken import — the brace was never closed.
        // Skip this line entirely (the next import will be kept).
        i++
        continue
      }

      // Otherwise collect the multi-line import normally
      let importBlock = line
      i++
      while (i < lines.length) {
        importBlock += '\n' + lines[i]
        if (lines[i].includes('}')) break
        // If we hit another import statement inside the block, the block is broken
        if (/^import\s+/.test(lines[i].trim())) {
          // Broken mid-import — discard the incomplete outer import,
          // rewind to this line and let the loop handle it fresh
          importBlock = ''
          break
        }
        i++
      }
      if (importBlock) {
        result.push(importBlock)
      }
      i++
      continue
    }

    result.push(line)
    i++
  }

  return result.join('\n')
}

/**
 * Root package names actually declared as Sandpack dependencies — see
 * components/chat/sandpack-preview.tsx's `customSetup.dependencies`. The
 * conditional ones (lucide-react/recharts/@stripe/*) are included
 * unconditionally here because their trigger condition in that file is
 * exactly "the generated code imports them" — the same condition that puts
 * them in front of this function, so by the time a file reaches here they
 * are always going to be added as a real dependency too.
 */
const ALLOWLISTED_PACKAGE_ROOTS = new Set([
  'react',
  'react-dom',
  'prop-types',
  'lucide-react',
  'recharts',
  '@stripe/stripe-js',
  '@stripe/react-stripe-js',
  'clsx',
  'tailwind-merge',
])

/** The root package name a bare import specifier resolves against (handles subpaths and scoped packages). */
function packageRoot(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/')
  return spec.split('/')[0]
}

function isAllowlistedPackage(spec: string): boolean {
  return ALLOWLISTED_PACKAGE_ROOTS.has(packageRoot(spec))
}

/**
 * Generic safety net: stub out any bare (non-relative) import of a package
 * that isn't actually available in Sandpack, so a whole-tree-crashing
 * unresolvable import degrades to an inert no-op instead. This intentionally
 * runs after every package-specific stub above (framer-motion, next/*,
 * react-icons, etc. when present) — those are more faithful to each
 * package's real behavior and always win when they've already consumed the
 * import; this only ever sees what's left over.
 *
 * Each imported binding becomes its own inert `const`: a Proxy over a no-op
 * function. Used as a JSX tag (`<Icon/>`, `<motion.div>`) it renders its
 * children (or null); used as a value, hook, or nested property access
 * (`Icon.Solid`, `useForm().register`) the `get` trap hands back the same
 * stub so chained/destructured usage keeps working instead of throwing.
 * Deliberately NOT a single shared helper — Sandpack's bundler sees each
 * generated file in isolation, so the stub has to be self-contained per
 * import site.
 */
function stubUnresolvableBareImports(code: string): string {
  let fixed = code

  // Side-effect-only bare imports, e.g. `import 'some-polyfill'`.
  fixed = fixed.replace(
    /^([ \t]*)import\s+['"]([^'".][^'"]*)['"]\s*;?[ \t]*$/gm,
    (match, _indent: string, pkg: string) => (isAllowlistedPackage(pkg) ? match : '')
  )

  // Imports with bindings: default, namespace, named, or a mix.
  fixed = fixed.replace(
    /^([ \t]*)import\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'".][^'"]*)['"]\s*;?[ \t]*$/gm,
    (match, indent: string, typeOnly: string | undefined, clause: string, pkg: string) => {
      if (isAllowlistedPackage(pkg)) return match
      // `import type {...}` bindings have no runtime value — safe to drop entirely.
      if (typeOnly) return ''
      const locals = parseImportClauseLocals(clause)
      if (locals.length === 0) return ''
      return (
        locals
          .map((name) => `${indent}const ${name} = ${genericInertStub(name, isUsedAsJsxTag(code, name))};`)
          .join('\n') + '\n'
      )
    }
  )

  return fixed
}

/**
 * Generic safety net for re-export statements — the export-side counterpart
 * to stubUnresolvableBareImports above. Sandpack resolves the specifier on
 * `export ... from 'pkg'` exactly like a plain `import ... from 'pkg'`, so an
 * unresolvable package reached via a re-export crashes the whole compile the
 * same way, but none of the import-shaped regexes above ever match this
 * syntax (there's no `import` keyword) — confirmed gap, #1181.
 */
function stubUnresolvableReExports(code: string): string {
  let fixed = code

  // `export * from 'pkg'` — the re-exported binding names are unknowable
  // from this file alone, so there's nothing to stub; dropping it entirely
  // is the only safe move (same precedent as dropping a side-effect-only
  // import above).
  fixed = fixed.replace(
    /^([ \t]*)export\s+\*\s+from\s*['"]([^'".][^'"]*)['"]\s*;?[ \t]*$/gm,
    (match, _indent: string, pkg: string) => (isAllowlistedPackage(pkg) ? match : '')
  )

  // `export * as Name from 'pkg'` — a namespace re-export; unlike the bare
  // `export *` above, Name IS a real local binding, so it gets the same
  // stub a namespace import would.
  fixed = fixed.replace(
    /^([ \t]*)export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'".][^'"]*)['"]\s*;?[ \t]*$/gm,
    (match, indent: string, name: string, pkg: string) =>
      isAllowlistedPackage(pkg)
        ? match
        : `${indent}export const ${name} = ${genericInertStub(name, isUsedAsJsxTag(code, name))};\n`
  )

  // `export { a, b as c } from 'pkg'` / `export type { ... } from 'pkg'`.
  fixed = fixed.replace(
    /^([ \t]*)export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'".][^'"]*)['"]\s*;?[ \t]*$/gm,
    (match, indent: string, typeOnly: string | undefined, names: string, pkg: string) => {
      if (isAllowlistedPackage(pkg)) return match
      // `export type { ... } from 'pkg'` has no runtime value — safe to drop.
      if (typeOnly) return ''

      const stubLines: string[] = []
      for (const raw of names.split(',').map((n) => n.trim()).filter(Boolean)) {
        const aliasMatch = raw.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
        const exportedName = aliasMatch ? aliasMatch[2] : raw
        // Self-reference the binding that's ACTUALLY declared — the local
        // name on the export side (`exportedName`), never the package's
        // original export name (`a` in `a as c`), which this file never
        // declares at all and would throw ReferenceError at call time.
        if (exportedName === 'default') {
          // `export { default } from 'pkg'` / `export { x as default } from
          // 'pkg'` re-export as THIS module's own default export.
          // `export const default = ...` is a syntax error, and so is a
          // bare `default` keyword used as a value inside the stub
          // expression itself (reserved word) — give the self-reference its
          // own non-reserved local name, wrapped in an IIFE that evaluates
          // to just the stub value.
          const stub = genericInertStub('__default', isUsedAsJsxTag(code, exportedName))
          stubLines.push(`${indent}export default (function () { const __default = ${stub}; return __default })();`)
        } else {
          const stub = genericInertStub(exportedName, isUsedAsJsxTag(code, exportedName))
          stubLines.push(`${indent}export const ${exportedName} = ${stub};`)
        }
      }
      if (stubLines.length === 0) return ''
      return stubLines.join('\n') + '\n'
    }
  )

  return fixed
}

/** Whether `name` ever appears as a JSX tag in the file (`<Name`, `<Name.Sub>`), including self-closing/with-attrs/compound usage. */
function isUsedAsJsxTag(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<\\s*${escaped}(?:[\\s/>]|\\.[A-Za-z_$])`).test(code)
}

/** Extracts the local binding name(s) an import clause introduces (before `from`). */
function parseImportClauseLocals(clause: string): string[] {
  const trimmed = clause.trim()
  if (!trimmed) return []

  const namespaceMatch = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/)
  if (namespaceMatch) return [namespaceMatch[1]]

  const braceMatch = trimmed.match(/^(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]*)\}$/)
  if (braceMatch) {
    const locals: string[] = []
    if (braceMatch[1]) locals.push(braceMatch[1])
    for (const raw of braceMatch[2].split(',').map((n) => n.trim()).filter(Boolean)) {
      const aliasMatch = raw.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      locals.push(aliasMatch ? aliasMatch[2] : raw)
    }
    return locals
  }

  const defaultMatch = trimmed.match(/^([A-Za-z_$][\w$]*)$/)
  return defaultMatch ? [defaultMatch[1]] : []
}

/**
 * A single inert value, shaped by whether `name` is ever used as a JSX tag
 * elsewhere in the file:
 *  - JSX-tag-shaped (`<Icon/>`, `<motion.div>`): calling it is what React
 *    does during render, so it must return a valid node — the component's
 *    children, or null.
 *  - Otherwise treated as hook/utility-shaped (`useForm()`, `axios.get()`):
 *    calling it returns the stub itself, so destructuring or chaining off
 *    the result (`const { register } = useForm()`) never throws.
 * Either way, property access (`Icon.Solid`, `useForm.something`) always
 * hands back the same self-reference via the `get` trap instead of throwing
 * on an unknown property.
 *
 * Deliberately no TS type annotations — Sandpack's bundler only transpiles
 * (esbuild-style, no type-checking), so plain JS is all this needs, and it
 * keeps the stub directly executable for a real runtime test
 * (`new Function(...)`) rather than only a string-shape assertion.
 */
function genericInertStub(name: string, isJsxTag: boolean): string {
  const callResult = isJsxTag
    ? `(p && typeof p === 'object' && 'children' in p) ? (p.children ?? null) : null`
    : name
  return `new Proxy(function (...args) { const p = args[0]; return ${callResult} }, { get: () => ${name} })`
}
