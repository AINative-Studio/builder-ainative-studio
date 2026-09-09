import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Design System Picker (#593) — found via a real end-to-end production test:
 * a single-file generated App.tsx correctly referenced a chosen design
 * system's real fonts (fontFamily: "'Orbitron', sans-serif") but the font was
 * never actually LOADED — the preview route's static HTML wrapper
 * (app/api/preview/[id]/route.ts) always hardcoded Inter+Poppins regardless
 * of what was generated, because a single-file component has no <head> of
 * its own to inject a <link> into. This looks up the chosen system (stored
 * alongside the generation via preview-store's designSystemId) and loads
 * ITS real Google Fonts instead.
 */
describe('preview [id] route loads the chosen design system\'s real fonts (2026-09-09 bugfix)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  it('looks up the chosen system from the stored chat data, not a client-supplied value', () => {
    expect(source).toMatch(/getDesignSystem\(getChatData\(id\)\?\.designSystemId/)
  })

  it('builds the font link from the real googleFontsUrl helper, not a hand-written string', () => {
    expect(source).toMatch(/googleFontsUrl\(chosenPreviewSystem\)/)
  })

  it('falls back to the original Inter+Poppins link when no system was chosen', () => {
    expect(source).toContain(
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@300;400;500;600;700;800;900&display=swap',
    )
  })

  it('the Tailwind font-sans config also uses the chosen system\'s body font', () => {
    expect(source).toMatch(/chosenPreviewSystem\.fonts\.body\.family/)
  })
})
