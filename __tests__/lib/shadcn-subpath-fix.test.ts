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
    // Input lives in its own file if mapped; otherwise stays — either way must resolve
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
})
