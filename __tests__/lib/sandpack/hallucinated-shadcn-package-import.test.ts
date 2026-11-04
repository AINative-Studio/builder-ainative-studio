import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real bug found live (2026-11-04, "me-product", a fresh real generation):
 * a generation wrote its OWN /src/components/ui/button.tsx (and input/card/
 * dialog/table) importing a component from a HALLUCINATED 'shadcn'/
 * 'shadcn/*' npm package — not real, not provided by this pipeline:
 *
 *   import { Button as ShadcnButton } from 'shadcn'
 *
 * buildSandpackFiles() seeds sandpackFiles with the real, working, self-
 * contained builtin bundle (shadcnFiles, ./shadcn-bundle.ts) at this exact
 * path, then unconditionally overwrote it with the generated file's content
 * — so the real builtin's correct implementation was replaced by one that
 * imports a package that will never resolve. Sandpack's bundler then fails
 * the ENTIRE compile (its dependency walker rejects on ANY unresolvable
 * import across ALL provided files, not just reachable ones — same
 * mechanism as the next/font/google case this file already documents):
 * "Cannot find module 'shadcn' from '/components/ui/button.tsx'" — a
 * permanent, unrecoverable crash before a single real product/cart/checkout
 * interaction could ever run.
 */
describe('buildSandpackFiles — a generated builtin-path file importing from the hallucinated "shadcn" package is skipped', () => {
  it('keeps the real builtin Button when the generated button.tsx imports from "shadcn"', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': [
        "import React from 'react';",
        "import { Button as ShadcnButton } from 'shadcn';",
        'export function Button({ children, className, ...props }) {',
        "  return <ShadcnButton className={`rounded-[0px] ${className}`} {...props}>{children}</ShadcnButton>;",
        '}',
      ].join('\n'),
    })

    expect(built['/components/ui/button.tsx']).not.toMatch(/from\s+['"]shadcn['"]/)
    expect(built['/components/ui/button.tsx']).toContain('ButtonHTMLAttributes')
  })

  it('keeps the real builtin for every shadcn wrapper path (button/input/card/dialog/table) — the real multi-file repro', () => {
    const hallucinatedWrapper = (realName: string, pkg = 'shadcn') =>
      [
        "import React from 'react';",
        `import { ${realName} as Shadcn${realName} } from '${pkg}';`,
        `export function ${realName}(props) { return <Shadcn${realName} {...props} />; }`,
      ].join('\n')

    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': hallucinatedWrapper('Button'),
      '/src/components/ui/input.tsx': hallucinatedWrapper('Input'),
      '/src/components/ui/card.tsx': hallucinatedWrapper('Card'),
      '/src/components/ui/table.tsx': hallucinatedWrapper('Table'),
      '/src/components/ui/dialog.tsx': hallucinatedWrapper('Dialog', 'shadcn/dialog'),
    })

    for (const path of ['/components/ui/button.tsx', '/components/ui/input.tsx', '/components/ui/card.tsx', '/components/ui/table.tsx', '/components/ui/dialog.tsx']) {
      expect(built[path], `${path} must not import the hallucinated package`).not.toMatch(/from\s+['"]shadcn/)
    }
  })

  it('does NOT skip a generated builtin-path file that correctly has no external import (a legitimate override)', () => {
    const built = buildSandpackFiles({
      '/src/components/ui/button.tsx': [
        "import React from 'react'",
        "export function Button({ children, ...props }) { return <button {...props}>{children}</button> }",
      ].join('\n'),
    })

    // A real, self-contained override (no hallucinated import) is legitimate
    // generated content and should win over the builtin, same as before.
    expect(built['/components/ui/button.tsx']).toContain('<button {...props}>{children}</button>')
  })

  it('does NOT skip a file at a non-builtin path that happens to import something named "shadcn-like"', () => {
    const built = buildSandpackFiles({
      '/src/components/MyWrapper.tsx': [
        "import React from 'react'",
        "import { Thing } from 'shadcn-adjacent-but-different-package'",
        'export function MyWrapper() { return <Thing /> }',
      ].join('\n'),
    })

    // Not a builtin path at all — generated content always wins here,
    // regardless of what it imports (this fix only protects REAL builtin
    // paths from being shadowed by a broken override).
    expect(built['/components/MyWrapper.tsx']).toContain('MyWrapper')
  })
})
