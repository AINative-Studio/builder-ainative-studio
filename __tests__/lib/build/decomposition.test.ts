import { describe, it, expect } from 'vitest'
import { hasFileMarkers, shouldDecompose, buildDecompositionPrompt, buildFixAndDecomposePrompt } from '@/lib/build/decomposition'

const bigSingleFile = 'export default function App(){\n' + '  // logic\n'.repeat(500) + '  return <div/>\n}'

describe('decomposition (#293 · Phase 5)', () => {
  it('detects file markers', () => {
    expect(hasFileMarkers('// --- FILE: src/App.tsx ---\ncode')).toBe(true)
    expect(hasFileMarkers('export default function App(){}')).toBe(false)
  })

  it('decomposes a large single-file complex app', () => {
    expect(shouldDecompose(bigSingleFile, true)).toBe(true)
  })

  it('does NOT decompose when the idea does not warrant multi-file', () => {
    expect(shouldDecompose(bigSingleFile, false)).toBe(false)
  })

  it('does NOT decompose code that already has file markers', () => {
    const multi = '// --- FILE: src/App.tsx ---\n' + bigSingleFile
    expect(shouldDecompose(multi, true)).toBe(false)
  })

  it('does NOT decompose a thin stub (needs enrichment, not splitting)', () => {
    expect(shouldDecompose('export default function App(){return <div>hi</div>}', true)).toBe(false)
  })

  it('prompt instructs a split-only refactor into the marker format', () => {
    const p = buildDecompositionPrompt('a CRM', bigSingleFile)
    expect(p).toMatch(/pure structural split/i)
    expect(p).toContain('// --- FILE: src/App.tsx ---')
    expect(p).toMatch(/relative imports/i)
    expect(p).toMatch(/Keep all[\s\S]*\/api\/db/i)
  })

  it('prompt caps the embedded source so it cannot blow the context', () => {
    const huge = 'x'.repeat(50000)
    const p = buildDecompositionPrompt('a CRM', huge)
    expect(p.length).toBeLessThan(17000)
  })

  it('combined fix+split prompt includes BOTH the fixes and the marker format (#305)', () => {
    const p = buildFixAndDecomposePrompt('a CRM', '1) PERSIST REAL DATA via /api/db', bigSingleFile)
    expect(p).toMatch(/STEP 1/i)
    expect(p).toContain('/api/db')
    expect(p).toMatch(/STEP 2/i)
    expect(p).toContain('// --- FILE: src/App.tsx ---')
  })

  it('combined prompt caps the embedded source', () => {
    const p = buildFixAndDecomposePrompt('a CRM', 'fix X', 'x'.repeat(50000))
    expect(p.length).toBeLessThan(17500)
  })
})
