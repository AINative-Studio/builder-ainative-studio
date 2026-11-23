import { describe, it, expect } from 'vitest'
import { buildFileMarkerBlob, checkRenderHealth } from '@/lib/build/render-health-recheck'

/**
 * #2164 — pure re-verification of a company's CURRENT persisted generation.
 * See lib/build/render-health-recheck.ts's doc comment for why this exists:
 * nothing previously re-checked whether a company a closed issue named as
 * broken had actually been repaired.
 */
describe('checkRenderHealth', () => {
  it('reports hasFilesMap:false and clean:false for an undefined files map', () => {
    const result = checkRenderHealth(undefined)
    expect(result.hasFilesMap).toBe(false)
    expect(result.clean).toBe(false)
  })

  it('reports hasFilesMap:false for an empty files map', () => {
    const result = checkRenderHealth({})
    expect(result.hasFilesMap).toBe(false)
  })

  it('reports clean:true for a genuinely complete, valid generation', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App() {\n  return <div><Header /></div>\n}`,
      '/src/components/Header.tsx': `export default function Header() {\n  return <header>Hi</header>\n}`,
    }
    const result = checkRenderHealth(files)
    expect(result.hasFilesMap).toBe(true)
    expect(result.missingImports).toEqual([])
    expect(result.truncatedFiles).toEqual([])
    expect(result.validationError).toBeNull()
    expect(result.clean).toBe(true)
  })

  it('flags a genuinely missing local import (the #2159/#2169 repro shape)', () => {
    const files = {
      '/src/App.tsx': `import Footer from './components/Footer'\nexport default function App() {\n  return <div><Footer /></div>\n}`,
    }
    const result = checkRenderHealth(files)
    expect(result.hasFilesMap).toBe(true)
    expect(result.missingImports).toContain('./components/Footer')
    expect(result.clean).toBe(false)
  })

  it('flags a truncated component file with no export at all (the #2013/#2145 repro shape)', () => {
    const files = {
      '/src/App.tsx': `import Panel from './components/Panel'\nexport default function App() {\n  return <div><Panel /></div>\n}`,
      '/src/components/Panel.tsx': `function Panel() {\n  const x = 1\n`, // cut off mid-statement, no export
    }
    const result = checkRenderHealth(files)
    expect(result.hasFilesMap).toBe(true)
    expect(result.truncatedFiles).toContain('/src/components/Panel.tsx')
    expect(result.clean).toBe(false)
  })

  it('flags an undefined variable reference via the real validateJavaScriptCode path (the #2151 repro shape)', () => {
    const files = {
      '/src/App.tsx': `export default function App() {\n  return <div>{sensorReadings.length}</div>\n}`,
    }
    const result = checkRenderHealth(files)
    expect(result.hasFilesMap).toBe(true)
    expect(result.missingImports).toEqual([])
    expect(result.truncatedFiles).toEqual([])
    expect(result.validationError).toContain('sensorReadings')
    expect(result.clean).toBe(false)
    // #2220: a bare undefined-VARIABLE reference (not a JSX component) has
    // no applicable self-heal injector in buildSandpackFiles() — it
    // genuinely survives self-heal, so this is correctly confirmedRenderBreaking
    // now that builtValidationError re-checks validateJavaScriptCode against
    // the self-healed output too (previously this fell through as neither
    // selfHealed nor confirmedRenderBreaking — a real gap, not a safe "fine").
    expect(result.builtValidationError).toContain('sensorReadings')
    expect(result.confirmedRenderBreaking).toBe(true)
    expect(result.selfHealed).toBe(false)
  })

  // #2198: this loop found two already-open issues (#2195 "dispatch",
  // #2169 "silo"/f4k20l) that claimed "confirmed render-breaking" from a raw
  // missingImports/truncatedFiles hit alone, when main's real
  // buildSandpackFiles() pipeline (stubMissingLocalComponents/
  // stubTruncatedFiles) already repairs both before Sandpack ever renders
  // them. These two cases pin that exact repro shape so this distinction
  // can never silently regress.
  it('reports selfHealed:true and confirmedRenderBreaking:false for a missing import the real pipeline stubs (the #2159/#2169 dispatch/silo shape)', () => {
    const files = {
      '/src/App.tsx': `import Footer from './components/Footer'\nexport default function App() {\n  return <div><Footer /></div>\n}`,
    }
    const result = checkRenderHealth(files)
    // Unchanged raw-detector behavior — still a real generation-quality gap.
    expect(result.missingImports).toContain('./components/Footer')
    expect(result.clean).toBe(false)
    // But buildSandpackFiles() synthesizes a safe stub at the resolved path,
    // so this never reaches a real visitor as a crash.
    expect(result.builtMissingImports).toEqual([])
    expect(result.selfHealed).toBe(true)
    expect(result.confirmedRenderBreaking).toBe(false)
  })

  it('reports selfHealed:true and confirmedRenderBreaking:false for a truncated file the real pipeline stubs (the #2195 Pricing.tsx shape)', () => {
    const files = {
      '/src/App.tsx': `import Pricing from './components/Pricing'\nexport default function App() {\n  return <div><Pricing /></div>\n}`,
      // Real repro: cut off right after the one hook call, no JSX, no return.
      '/src/components/Pricing.tsx': `import React, { useState } from 'react'\nexport default function Pricing() {\n  const [annual, setAnnual] = useState(true);\n}`,
    }
    const result = checkRenderHealth(files)
    expect(result.truncatedFiles).toContain('/src/components/Pricing.tsx')
    expect(result.clean).toBe(false)
    expect(result.builtTruncatedFiles).toEqual([])
    expect(result.selfHealed).toBe(true)
    expect(result.confirmedRenderBreaking).toBe(false)
  })

  /**
   * #2220 — validationError (validateJavaScriptCode's "Element type is
   * invalid" check) was never re-verified against the self-healed
   * buildSandpackFiles() output, only missingImports/truncatedFiles were
   * (#2198's fix). A bare JSX identifier used with zero import anywhere —
   * but genuinely defined/exported in a SIBLING file — is exactly the
   * shape buildSandpackFiles()'s sibling-import injector resolves, yet
   * this read as validationError-driven "confirmed render-breaking" before
   * this fix. Confirmed live for real companies `revela`
   * (XIcon/MenuIcon/.../ from a sibling Icons.tsx) and `younova` (TaskList
   * from a sibling default-exported TaskList.tsx) — both already fixed and
   * closed (#2026/#2027, #2021/#2029/#2031), which this bug in the
   * RE-VERIFICATION tool itself was making read as still-broken again.
   */
  it('reports selfHealed:true (not confirmedRenderBreaking) for a bare JSX identifier the sibling-import injector resolves (the revela/younova #2220 shape)', () => {
    const files = {
      '/src/App.tsx': `export default function App() {\n  return <Navbar />\n}`,
      '/src/components/Icons.tsx': `export const XIcon = (props) => <div {...props} />;\nexport const MenuIcon = (props) => <div {...props} />;`,
      '/src/components/Navbar.tsx': `import React, { useState } from 'react'\nexport const Navbar = () => {\n  const [open] = useState(false);\n  return open ? <XIcon size={24} /> : <MenuIcon size={24} />;\n}`,
    }
    const result = checkRenderHealth(files)
    // Raw persisted Navbar.tsx really does reference XIcon/MenuIcon with no
    // import anywhere — a genuine raw validationError.
    expect(result.validationError).toContain('is used but not defined or imported')
    expect(result.clean).toBe(false)
    // But buildSandpackFiles()'s sibling-import injector adds the correct
    // `import { XIcon, MenuIcon } from './Icons'`, so this never reaches a
    // real visitor as a crash.
    expect(result.builtValidationError).toBeNull()
    expect(result.selfHealed).toBe(true)
    expect(result.confirmedRenderBreaking).toBe(false)
  })
})

describe('buildFileMarkerBlob', () => {
  it('marks each code file with the FILE_MARKER convention and strips a leading slash', () => {
    const blob = buildFileMarkerBlob({
      '/src/App.tsx': 'export default function App() { return null }',
    })
    expect(blob).toContain('// --- FILE: src/App.tsx ---')
    expect(blob).toContain('export default function App()')
  })

  it('excludes non-code files (assets, .d.ts) from the blob', () => {
    const blob = buildFileMarkerBlob({
      '/src/App.tsx': 'export default function App() { return null }',
      '/src/styles.css': 'body { color: red }',
      '/src/types.d.ts': 'export type Foo = string',
    })
    expect(blob).not.toContain('styles.css')
    expect(blob).not.toContain('types.d.ts')
  })

  it('returns an empty string for a files map with no code files', () => {
    expect(buildFileMarkerBlob({ '/src/styles.css': 'body {}' })).toBe('')
  })

  // Overnight render-integrity loop, live false-positive confirmed against
  // 'ridgeline' and 'shingle': app/robots.ts and app/sitemap.ts are ordinary,
  // valid Next.js App Router TypeScript (return-type annotations, `as const`)
  // that this plain-JS-oriented validator was never meant to parse, and
  // production never feeds them through it either — only the separate
  // Railway/Gitea deploy path (company-scaffold.ts) ever reads them.
  // Concatenating them into the same blob as the Sandpack component tree
  // threw a catastrophic "Unexpected token" parse error for two companies
  // with nothing actually wrong with their generation.
  it('excludes Next.js App Router special files (app/robots.ts, app/sitemap.ts, app/layout.tsx) from the blob', () => {
    const blob = buildFileMarkerBlob({
      '/src/App.tsx': 'export default function App() { return null }',
      '/app/robots.ts': "export default function robots(): MetadataRoute.Robots { return { rules: [] } }",
      '/app/sitemap.ts': "export default function sitemap(): MetadataRoute.Sitemap { return [{ url: 'https://x', changeFrequency: 'weekly' as const, priority: 1 }] }",
      '/app/layout.tsx': 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html> }',
    })
    expect(blob).toContain('App.tsx')
    expect(blob).not.toContain('robots.ts')
    expect(blob).not.toContain('sitemap.ts')
    expect(blob).not.toContain('layout.tsx')
    expect(blob).not.toContain('MetadataRoute')
  })

  it('checkRenderHealth no longer reports a validationError for a real company whose only "defect" is a correct app/sitemap.ts using `as const`', () => {
    const files = {
      '/src/App.tsx': 'export default function App() { return null }',
      '/app/sitemap.ts':
        "import { MetadataRoute } from 'next'\nexport default function sitemap(): MetadataRoute.Sitemap {\n  return [{ url: 'https://this.app/', changeFrequency: 'weekly' as const, priority: 1 }]\n}",
    }
    const result = checkRenderHealth(files)
    expect(result.validationError).toBeNull()
  })
})
