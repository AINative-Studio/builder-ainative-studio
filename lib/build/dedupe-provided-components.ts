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
