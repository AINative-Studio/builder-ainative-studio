import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * DesignPicker (#591) — the new build-flow screen where a founder picks one
 * of lib/design-systems/catalog.ts's systems before Cody generates their app.
 * Structural checks (this codebase's established pattern for screen
 * components — see seo-*.test.ts) rather than a full render test, since no
 * other screen component (Fork, Intake) has one either; the real logic is
 * covered by the PICK_DESIGN_SYSTEM reducer tests in state.test.ts and the
 * DESIGN_SYSTEMS catalog tests.
 */
describe('DesignPicker screen (2026-09-09)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/build/screens/DesignPicker.tsx'),
    'utf8',
  )

  it('renders every system from the real catalog, not a hardcoded list', () => {
    expect(source).toMatch(/DESIGN_SYSTEMS\.map/)
    expect(source).toMatch(/from ['"]@\/lib\/design-systems\/catalog['"]/)
  })

  it('choosing a system dispatches PICK_DESIGN_SYSTEM then routes to intake', () => {
    expect(source).toMatch(/PICK_DESIGN_SYSTEM/)
    expect(source).toMatch(/choose[\s\S]{0,300}GOTO_SCREEN[\s\S]{0,50}intake/)
  })

  it('has a working skip path that also reaches intake without picking a system', () => {
    expect(source).toMatch(/const skip = \(\)[\s\S]{0,150}GOTO_SCREEN[\s\S]{0,50}intake/)
  })

  it('has a back escape hatch to fork — never traps the founder', () => {
    expect(source).toMatch(/GOTO_SCREEN[\s\S]{0,30}screen: 'fork'/)
  })
})
