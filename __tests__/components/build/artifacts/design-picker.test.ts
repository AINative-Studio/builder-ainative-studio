import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * DesignPicker (#591, made a real tracked artifact 2026-09-09) — mirrors
 * artifacts/Wedge.tsx's exact interrupt-view pattern. Structural checks
 * (this codebase's established pattern for artifact/screen components —
 * see seo-*.test.ts, and Wedge itself has no render test either), since the
 * real logic is covered by the PICK_DESIGN_SYSTEM/SKIP_DESIGN_SYSTEM reducer
 * tests in state.test.ts and the DESIGN_SYSTEMS catalog tests.
 */
describe('DesignPicker artifact body (2026-09-09)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/artifacts/DesignPicker.tsx'),
    'utf8',
  )

  it('renders every system from the real catalog, not a hardcoded list', () => {
    expect(source).toMatch(/DESIGN_SYSTEMS\.map/)
    expect(source).toMatch(/from ['"]@\/lib\/design-systems\/catalog['"]/)
  })

  it('choosing a system dispatches PICK_DESIGN_SYSTEM', () => {
    expect(source).toMatch(/dispatch\(\{ type: 'PICK_DESIGN_SYSTEM', designSystemId: id \}\)/)
  })

  it('has a working skip path that dispatches SKIP_DESIGN_SYSTEM', () => {
    expect(source).toMatch(/dispatch\(\{ type: 'SKIP_DESIGN_SYSTEM' \}\)/)
  })

  it('is gated on designStepDone, mirroring the Wedge interrupt-view pattern', () => {
    expect(source).toMatch(/state\.designStepDone/)
  })

  it('the confirmed state advances via goView, resolved per-track (app: brief, company: thesis)', () => {
    // 2026-09-10 fix (Meridian): the Company track now visits 'design' too,
    // and its first real view after it is 'thesis', not the App track's
    // 'brief' — hardcoding 'brief' here would send a Company-track founder
    // to a view id that doesn't exist on that track.
    expect(source).toMatch(/goView\(NEXT_VIEW_AFTER_DESIGN\[state\.track\]\)/)
    expect(source).toMatch(/app:\s*'brief'/)
    expect(source).toMatch(/company:\s*'thesis'/)
  })
})

describe('ArtifactRouter wires design -> DesignPicker (2026-09-09)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/ArtifactRouter.tsx'),
    'utf8',
  )

  it('registers design in SPECIAL_BODIES', () => {
    expect(source).toMatch(/design:\s*DesignPicker/)
  })
})

describe('useAutoplay treats design as a real interrupt-view (2026-09-09)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'lib/build/useAutoplay.ts'),
    'utf8',
  )

  it('INTERRUPT_VIEWS includes design alongside wedge', () => {
    expect(source).toMatch(/INTERRUPT_VIEWS = new Set\(\['wedge', 'design'\]\)/)
  })

  it('waits for designStepDone before completing the design view', () => {
    expect(source).toMatch(/next === 'design' && !state\.designStepDone/)
  })
})
