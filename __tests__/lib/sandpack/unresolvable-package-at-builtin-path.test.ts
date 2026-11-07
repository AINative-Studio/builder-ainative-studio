import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Generalizes #1790's fix (hallucinated-shadcn-package-import.test.ts), which
 * only caught a generated builtin-path override importing from the literal
 * 'shadcn'/'shadcn/*' package. The real root cause isn't specific to that one
 * package name: Sandpack's dependency walker fails the ENTIRE compile on ANY
 * unresolvable bare import across ALL provided files (confirmed mechanism,
 * #1124/#1125/#1790) — and a file at a known builtin path is structurally
 * exempt from `buildSandpackFiles()`'s own second-pass `fixJsxErrors()` safety
 * net (`if (builtinPaths.has(path)) continue`), which assumes builtin-path
 * content is always the known-safe original and never re-checks it once a
 * generated override has already replaced it in the first pass. So a model
 * hallucinating any OTHER plausible-sounding package name at a builtin path
 * (not just 'shadcn') carried the identical whole-compile-crash risk, with no
 * narrow fix covering it. `hasUnresolvableBareImport()` now reuses jsx-fixer's
 * own real Sandpack-dependency allowlist instead of a single hardcoded name.
 */
describe('buildSandpackFiles — a generated builtin-path file importing ANY unresolvable package is skipped (not just "shadcn")', () => {
  it('keeps the real builtin when the override imports a different hallucinated package name', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': [
        "import React from 'react';",
        "import { Button as RadixButton } from '@radix-ui/themes';",
        'export function Button({ children, className, ...props }) {',
        "  return <RadixButton className={className} {...props}>{children}</RadixButton>;",
        '}',
      ].join('\n'),
    })

    expect(built['/components/ui/button.tsx']).not.toMatch(/@radix-ui\/themes/)
    expect(built['/components/ui/button.tsx']).toContain('ButtonHTMLAttributes')
  })

  it('keeps the real builtin when the override imports a hallucinated scoped package', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/card.tsx': [
        "import React from 'react';",
        "import { Card as ShadcnUiCard } from '@shadcn/ui';",
        'export function Card(props) { return <ShadcnUiCard {...props} />; }',
      ].join('\n'),
    })

    expect(built['/components/ui/card.tsx']).not.toMatch(/@shadcn\/ui/)
  })

  it('still catches the original literal "shadcn" package (no regression on #1790)', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/input.tsx': [
        "import React from 'react';",
        "import { Input as ShadcnInput } from 'shadcn';",
        'export function Input(props) { return <ShadcnInput {...props} />; }',
      ].join('\n'),
    })

    expect(built['/components/ui/input.tsx']).not.toMatch(/from\s+['"]shadcn['"]/)
  })

  it('does NOT skip a builtin-path override that only imports allowlisted packages (react, lucide-react)', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': [
        "import React from 'react'",
        "import { Loader2 } from 'lucide-react'",
        "export function Button({ children, ...props }) { return <button {...props}>{children}<Loader2 /></button> }",
      ].join('\n'),
    })

    // A real, resolvable override is legitimate generated content and
    // should win over the builtin, same as before this generalization.
    expect(built['/components/ui/button.tsx']).toContain('<Loader2 />')
  })

  it('does NOT skip a builtin-path override whose import is a relative or @/ path-aliased specifier', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': [
        "import React from 'react'",
        "import { cn } from '@/lib/utils'",
        "export function Button({ children, ...props }) { return <button className={cn('btn')} {...props}>{children}</button> }",
      ].join('\n'),
    })

    expect(built['/components/ui/button.tsx']).toContain("cn('btn')")
  })

  it('does NOT skip a file at a non-builtin path, regardless of what it imports', () => {
    const built = buildSandpackFiles({
      '/src/components/MyWrapper.tsx': [
        "import React from 'react'",
        "import { Thing } from 'totally-made-up-package'",
        'export function MyWrapper() { return <Thing /> }',
      ].join('\n'),
    })

    // Not a builtin path at all — generated content always wins here,
    // same as the existing non-builtin-path test in #1790's own suite.
    expect(built['/components/MyWrapper.tsx']).toContain('MyWrapper')
  })
})
