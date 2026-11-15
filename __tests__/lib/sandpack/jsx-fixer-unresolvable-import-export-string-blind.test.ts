import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Regression (#2064): stubUnresolvableBareImports()/stubUnresolvableReExports()
 * — the generic "stub any bare import/re-export of an unavailable package"
 * safety net near the end of fixJsxErrors()'s pipeline — ran their
 * line-anchored (`^...$`, `/m`) regexes directly against raw `code` with no
 * comment/string/template-literal mask at all, unlike every sibling stubber
 * in this file (stubNextOnlyModules, stubUnsupportedIconLibraries, etc.),
 * which all guard their rewrite with a maskPreservingOffsets() span check.
 * A decoy import/export line sitting inside a template literal — e.g. demo
 * code an SDK/docs-style landing page renders verbatim — got rewritten as if
 * it were real top-level code, corrupting the displayed example text.
 */
describe('stubUnresolvableBareImports/stubUnresolvableReExports (via fixJsxErrors) — string/template-literal-blind scan', () => {
  it('does not stub a decoy bare import-with-bindings line inside a template literal', () => {
    const code = [
      "import React from 'react'",
      'const demo = `',
      "import { useRouter } from 'next/navigation'",
      '`',
      'export default function App() {',
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    // The demo text must survive verbatim inside the template literal.
    expect(out).toContain("import { useRouter } from 'next/navigation'")
    // It must not have been rewritten into a stub const declaration.
    expect(out).not.toMatch(/const useRouter = /)
    // The template literal must still be terminated correctly.
    expect(out).toMatch(/const demo = `\nimport \{ useRouter \} from 'next\/navigation'\n`/)
  })

  it('does not stub a decoy side-effect-only bare import line inside a template literal', () => {
    const code = [
      'const demo = `',
      "import 'some-unresolvable-polyfill'",
      '`',
      'export default function App() {',
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toContain("import 'some-unresolvable-polyfill'")
    expect(out).toMatch(/const demo = `\nimport 'some-unresolvable-polyfill'\n`/)
  })

  it('does not stub a decoy `export { x } from "pkg"` re-export line inside a template literal', () => {
    const code = [
      'const demo = `',
      "export { useThing } from 'some-unresolvable-pkg'",
      '`',
      'export default function App() {',
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toContain("export { useThing } from 'some-unresolvable-pkg'")
    expect(out).not.toMatch(/^export const useThing = /m)
  })

  it('does not stub a decoy `export * from "pkg"` / `export * as Name from "pkg"` line inside a template literal', () => {
    const code = [
      'const demo = `',
      "export * from 'some-unresolvable-pkg'",
      "export * as Thing from 'some-other-unresolvable-pkg'",
      '`',
      'export default function App() {',
      '  return <pre>{demo}</pre>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toContain("export * from 'some-unresolvable-pkg'")
    expect(out).toContain("export * as Thing from 'some-other-unresolvable-pkg'")
    expect(out).not.toMatch(/^export const Thing = /m)
  })

  it('still stubs a genuinely unresolvable real (non-string) bare import/re-export — no regression', () => {
    const code = [
      "import { useThing } from 'some-unresolvable-pkg'",
      "export { otherThing } from 'some-other-unresolvable-pkg'",
      'export default function App() {',
      '  return <div>{typeof useThing}{typeof otherThing}</div>',
      '}',
    ].join('\n')

    const out = fixJsxErrors(code)
    expect(out).toMatch(/const useThing = /)
    expect(out).toMatch(/export const otherThing = /)
    expect(out).not.toContain("from 'some-unresolvable-pkg'")
    expect(out).not.toContain("from 'some-other-unresolvable-pkg'")
  })
})
