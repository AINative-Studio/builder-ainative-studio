import { describe, it, expect } from 'vitest'
import { multiFileEmphasis, multiFileUserDirective } from '@/lib/build/multifile-emphasis'

describe('multiFileEmphasis (#291)', () => {
  it('complex → REQUIRES multi-file split', () => {
    const s = multiFileEmphasis('complex')
    expect(s).toMatch(/MULTI-FILE REQUIRED/i)
    expect(s).toMatch(/Do NOT put everything in one file/i)
    expect(s).toMatch(/FILE:/i) // references the file-marker format
  })

  it('medium → PREFERS multi-file but allows single', () => {
    const s = multiFileEmphasis('medium')
    expect(s).toMatch(/PREFER MULTI-FILE/i)
    // (text spans lines) — it allows a single file for a genuinely single view.
    expect(s).toMatch(/single view/i)
    expect(s).toMatch(/one file is acceptable/i)
  })

  it('simple → single file is fine (fast Babel path)', () => {
    const s = multiFileEmphasis('simple')
    expect(s).toMatch(/SINGLE FILE IS FINE/i)
    expect(s).toMatch(/single self-contained/i)
    // Must NOT push a split on a simple app.
    expect(s).not.toMatch(/MULTI-FILE REQUIRED/i)
  })

  it('every level returns a non-empty block that can be appended to the system prompt', () => {
    for (const c of ['simple', 'medium', 'complex'] as const) {
      expect(multiFileEmphasis(c).trim().length).toBeGreaterThan(0)
      expect(multiFileEmphasis(c)).toMatch(/## FILE STRUCTURE FOR THIS BUILD/i)
    }
  })
})

describe('multiFileUserDirective (#291)', () => {
  it('instructs multi-file output with the EXACT marker format the parser expects', () => {
    const d = multiFileUserDirective()
    expect(d).toMatch(/OUTPUT THIS AS MULTIPLE FILES/i)
    // The exact // --- FILE: … --- marker parseMultiFileOutput looks for.
    expect(d).toContain('// --- FILE: src/App.tsx ---')
    expect(d).toMatch(/relative imports/i)
    expect(d).toMatch(/Do NOT put everything in one file/i)
  })

  it('shows App.tsx as the entry that imports the sections', () => {
    const d = multiFileUserDirective()
    expect(d).toMatch(/App\.tsx is the default-export entry/i)
    expect(d).toMatch(/Sidebar/i) // an example section component
  })
})
