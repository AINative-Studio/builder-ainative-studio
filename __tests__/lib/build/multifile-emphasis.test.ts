import { describe, it, expect } from 'vitest'
import { multiFileEmphasis, multiFileUserDirective, ideaWarrantsMultiFile } from '@/lib/build/multifile-emphasis'

describe('ideaWarrantsMultiFile (#291) — the actual gate', () => {
  it('multi-surface ideas → multi-file (true)', () => {
    // A CRM: sidebar + table + kanban + feed + report = 5 surfaces.
    expect(ideaWarrantsMultiFile('a CRM with sidebar nav, contacts table, deal pipeline kanban, activity feed, and reports page with charts')).toBe(true)
    // A dashboard: sidebar + kanban + panel + analytics + settings.
    expect(ideaWarrantsMultiFile('a project management dashboard with a sidebar, kanban board, team panel, analytics charts, and settings page')).toBe(true)
  })

  it('single-surface / simple ideas → single-file (false)', () => {
    expect(ideaWarrantsMultiFile('a simple counter app with an increment button')).toBe(false)
    expect(ideaWarrantsMultiFile('a todo list where you can add and remove tasks')).toBe(false)
    // A landing page names hero/features/pricing/footer but those are one-page sections,
    // not app surfaces — hero/features/pricing/footer aren't in SURFACE_TERMS, so it
    // stays single-file (a landing page IS a good single-file Babel case).
    expect(ideaWarrantsMultiFile('a landing page for a coffee shop with hero, features, pricing, and footer')).toBe(false)
  })

  it('explicit multi-page ask → true', () => {
    expect(ideaWarrantsMultiFile('a multi-page app for a small business')).toBe(true)
    expect(ideaWarrantsMultiFile('an app with several screens for booking')).toBe(true)
  })

  it('empty/whitespace → false', () => {
    expect(ideaWarrantsMultiFile('')).toBe(false)
    expect(ideaWarrantsMultiFile('   ')).toBe(false)
  })

  it('exactly 3 distinct surfaces → true (threshold)', () => {
    expect(ideaWarrantsMultiFile('an app with a table, a chart, and a settings page')).toBe(true)
  })

  it('2 surfaces → false (below threshold)', () => {
    expect(ideaWarrantsMultiFile('an app with a table and a chart')).toBe(false)
  })
})

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
