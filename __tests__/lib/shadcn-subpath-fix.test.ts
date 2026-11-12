import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression: the model routinely imports several shadcn components from ONE
 * ui/* file, e.g. `import { Card, CardHeader, Badge, Progress } from
 * './components/ui/button'`. But button.tsx only exports Button, so Card/Badge/
 * Progress are undefined → "Element type is invalid" / Sandpack "Something went
 * wrong". fixWrongShadcnSubpaths re-routes each component to the file that
 * actually exports it.
 */
describe('fixWrongShadcnSubpaths', () => {
  it('re-routes Card/Badge/Progress off ui/button to their correct files', () => {
    const code = [
      "import { Card, CardHeader, CardTitle, CardContent } from './components/ui/button'",
      "import { Badge } from './components/ui/button'",
      "import { Progress } from './components/ui/button'",
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/import \{ Card, CardHeader, CardTitle, CardContent \} from '\.\/components\/ui\/card'/)
    expect(out).toMatch(/import \{ Badge \} from '\.\/components\/ui\/badge'/)
    expect(out).toMatch(/import \{ Progress \} from '\.\/components\/ui\/progress'/)
    // Nothing should still pull Card from ui/button
    expect(out).not.toMatch(/Card[^']*from '\.\/components\/ui\/button'/)
  })

  it('leaves a correct import untouched', () => {
    const code = "import { Button } from './components/ui/button'"
    expect(fixJsxErrors(code).trim()).toBe(code)
  })

  it('keeps Card imported from ui/card as-is', () => {
    const code = "import { Card, CardHeader } from './components/ui/card'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/import \{ Card, CardHeader \} from '\.\/components\/ui\/card'/)
  })

  it('splits a mixed import into per-file imports', () => {
    const code = "import { Button, Card, Badge, Input } from './components/ui/button'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Button \} from '\.\/components\/ui\/button'/)
    expect(out).toMatch(/\{ Card \} from '\.\/components\/ui\/card'/)
    expect(out).toMatch(/\{ Badge \} from '\.\/components\/ui\/badge'/)
    expect(out).toMatch(/\{ Input \} from '\.\/components\/ui\/input'/)
  })

  // SHADCN_COMPONENT_FILE had no entry for `Input` at all, even though it's a
  // real export of shadcn-bundle.ts's input.tsx (`export const Input = ...`)
  // and is correctly mapped in both lib/sandpack/build-files.ts's
  // 'ui/input': ['Input'] table and lib/multi-file-parser.ts's own
  // `Input: 'input'` map. An Input imported from any wrong ui/* subpath (e.g.
  // grouped onto 'ui/card' by rewriteBarrelImports() when a barrel import
  // mixes Input with other shadcn names) was never re-routed — `Input`
  // resolved to `undefined` at runtime, the exact "Element type is invalid"
  // crash this function exists to prevent.
  it('re-routes Input off the wrong ui/* file', () => {
    const code = "import { Card, Input } from './components/ui/card'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Card \} from '\.\/components\/ui\/card'/)
    expect(out).toMatch(/\{ Input \} from '\.\/components\/ui\/input'/)
    expect(out).not.toMatch(/Input[^']*from '\.\/components\/ui\/card'/)
  })

  it('re-routes Input out of a barrel import mixed with other shadcn names', () => {
    const code = "import { Card, Badge, Input } from './components'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Input \} from '\.\/components\/ui\/input'/)
    expect(out).not.toMatch(/Input[^']*from '\.\/components\/ui\/card'/)
  })

  it('handles ../components/ui/* (from a nested file)', () => {
    const code = "import { Card } from '../components/ui/button'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Card \} from '\.\.\/components\/ui\/card'/)
  })

  // This SHADCN map had drifted out of sync with lib/sandpack/shadcn-bundle.ts's
  // real exports: DropdownMenu*, ScrollArea/ScrollBar, and Toast* were real
  // exports this map never covered, so a wrong-subpath import for any of them
  // (e.g. hallucinated onto ui/button) was never re-routed — same unfixed
  // "Element type is invalid" crash this file exists to prevent.
  it('re-routes DropdownMenu, ScrollArea, and Toast off the wrong ui/* file', () => {
    const code = [
      "import { DropdownMenu, DropdownMenuContent } from './components/ui/button'",
      "import { ScrollArea } from './components/ui/button'",
      "import { Toast, ToastTitle } from './components/ui/button'",
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ DropdownMenu, DropdownMenuContent \} from '\.\/components\/ui\/dropdown-menu'/)
    expect(out).toMatch(/\{ ScrollArea \} from '\.\/components\/ui\/scroll-area'/)
    expect(out).toMatch(/\{ Toast, ToastTitle \} from '\.\/components\/ui\/toast'/)
  })

  // #1879: the rewrite regex matched anywhere in the raw source, including
  // inside a `//` comment. The first rewritten line stayed commented (it
  // sits right after the original `//`), but any ADDITIONAL line the
  // multi-file split adds is a brand-new line with no `//` of its own —
  // turning a disabled/example import into a real, executing one.
  it('does not resurrect a commented-out wrong-subpath import as real code', () => {
    const code = [
      "// old approach, replaced below:",
      "// import { Card, Badge } from './components/ui/button'",
      "import { Button } from './components/ui/button'",
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^import \{ Badge \}/m)
    expect(out).not.toMatch(/^import \{ Card \}/m)
    // The real, uncommented import must still pass through untouched.
    expect(out).toMatch(/^import \{ Button \} from '\.\/components\/ui\/button'$/m)
  })

  // rewriteBarrelImports() (fix 0b, runs BEFORE fixWrongShadcnSubpaths) has its
  // own separate, local shadcn-name set for routing a bare `from './components'`
  // barrel import. That set only has the components fixWrongShadcnSubpaths's
  // SHADCN_COMPONENT_FILE map had when it was first written — it was never
  // updated when Switch/Textarea/Slider/Tooltip*/DropdownMenu*/ScrollArea*/
  // Skeleton/Toast*/Popover* were added to SHADCN_COMPONENT_FILE (and to the
  // real shadcn-bundle.ts export surface). A barrel import mixing one of these
  // with a recognized name falls into this function's "unknown" bucket, which
  // is hardcoded to './components/aikit' — a real path, but one that doesn't
  // export any of them. fixWrongShadcnSubpaths can't rescue it afterward
  // either: its regex only matches imports already rooted at
  // './components/ui/<file>', not './components/aikit'. Net result: Switch
  // (or Toast, DropdownMenu, ScrollArea, Skeleton, Tooltip, Popover, Textarea,
  // Slider) resolves to `undefined` at runtime — "Element type is invalid",
  // full render crash — for any generated app that barrel-imports one of
  // these alongside an older shadcn name.
  it('re-routes Switch and Toast out of a barrel import mixed with other shadcn names (not to aikit)', () => {
    const code = "import { Button, Switch, Toast } from './components'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Switch \} from '\.\/components\/ui\/switch'/)
    expect(out).toMatch(/\{ Toast \} from '\.\/components\/ui\/toast'/)
    expect(out).not.toMatch(/Switch[^']*from '\.\/components\/aikit'/)
    expect(out).not.toMatch(/Toast[^']*from '\.\/components\/aikit'/)
  })
})
