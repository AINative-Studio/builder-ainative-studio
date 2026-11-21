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
    // Not a missingImports/truncatedFiles-class defect, so the self-heal
    // check has nothing to report either way.
    expect(result.confirmedRenderBreaking).toBe(false)
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
})
