import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression for #2018: shadcn-bundle.ts emits per-component files only, no
 * 'ui/index.ts' barrel (unlike aikit-bundle.ts's real './components/aikit'
 * barrel) — so a bare `from './components/ui'` import is unresolvable in
 * Sandpack, and build-files.ts's AIKit/shadcn auto-import nets only reroute a
 * wrong-path import when the component is used as a JSX tag (#2016/PR
 * #2017). rewriteUiBarrelImports() closes the gap independent of JSX usage.
 */
describe('rewriteUiBarrelImports', () => {
  it('routes a known shadcn name off a bare ./components/ui barrel even when not used as a JSX tag', () => {
    const code = [
      "import { Badge } from './components/ui'",
      'const icon = { Badge }',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).toMatch(/import \{ Badge \} from '\.\/components\/ui\/badge'/)
    expect(out).not.toMatch(/Badge[^']*from '\.\/components\/ui'[^/]/)
  })

  it('splits multiple shadcn names from the barrel into per-file imports', () => {
    const code = "import { Card, Badge, Progress } from './components/ui'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Card \} from '\.\/components\/ui\/card'/)
    expect(out).toMatch(/\{ Badge \} from '\.\/components\/ui\/badge'/)
    expect(out).toMatch(/\{ Progress \} from '\.\/components\/ui\/progress'/)
  })

  it('leaves an unrecognized name on the original barrel path rather than guessing', () => {
    const code = "import { SomeUnknownThing } from './components/ui'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ SomeUnknownThing \} from '\.\/components\/ui'/)
    expect(out).not.toMatch(/SomeUnknownThing[^']*from '\.\/components\/aikit'/)
  })

  it('handles a mix of recognized and unrecognized names', () => {
    const code = "import { Button, SomeUnknownThing } from './components/ui'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Button \} from '\.\/components\/ui\/button'/)
    expect(out).toMatch(/\{ SomeUnknownThing \} from '\.\/components\/ui'/)
  })

  it('handles ../components/ui (from a nested file)', () => {
    const code = "import { Card } from '../components/ui'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/\{ Card \} from '\.\.\/components\/ui\/card'/)
  })

  it('does not touch a real subpath import like ./components/ui/button', () => {
    const code = "import { Button } from './components/ui/button'"
    expect(fixJsxErrors(code).trim()).toBe(code)
  })

  it('does not resurrect a commented-out ./components/ui barrel import as real code', () => {
    const code = [
      "// import { Card, Badge } from './components/ui'",
      'const x = 1',
    ].join('\n')
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/^import \{ Card \}/m)
    expect(out).not.toMatch(/^import \{ Badge \}/m)
    expect(out).toContain('const x = 1')
  })
})
