import { describe, it, expect } from 'vitest'
import { parsePRDForBuildSteps } from '@/lib/prd-parser'

/**
 * Real bug: parsePRDForBuildSteps's parseExplicitPages() used a flat
 * `\(([^)]+)\)` regex to capture an explicitly-listed page's route out of
 * lines like "1. **Homepage** (/)". That regex stops at the FIRST `)` on
 * the line, which breaks the moment the page NAME itself has its own
 * parenthetical aside before the route — e.g. a PRD line like
 * "3. **Pricing (Plans)** (/pricing)" — where the flat regex captured
 * "Plans" as the supposed route (failing the `startsWith('/')` check and
 * silently dropping the whole page) instead of the real "/pricing". The
 * same flat regex also corrupts a route containing a Next.js route-group
 * segment such as "(/(shop)/products)", truncating it to "/(shop".
 *
 * Fixed by depth-counting the line's top-level `(...)` groups and using the
 * LAST one as the route, so an earlier parenthetical aside in the name no
 * longer gets mistaken for it.
 */
describe('parsePRDForBuildSteps — explicit page list handles a nested paren before the route', () => {
  it('a page name with its own parenthetical aside is parsed correctly (previously dropped the page)', () => {
    const result = parsePRDForBuildSteps('3. **Pricing (Plans)** (/pricing)')
    expect(result.pages).toEqual([{ name: 'Pricing (Plans)', route: '/pricing' }])
  })

  it('a page name with a longer parenthetical aside is still parsed correctly', () => {
    const result = parsePRDForBuildSteps('1. **FAQ (Frequently Asked Questions)** (/faq)')
    expect(result.pages).toEqual([{ name: 'FAQ (Frequently Asked Questions)', route: '/faq' }])
  })

  it('a route containing a nested Next.js route-group segment is captured in full, not truncated', () => {
    const result = parsePRDForBuildSteps('- Shop Page (/(shop)/products)')
    expect(result.pages).toEqual([{ name: 'Shop Page', route: '/(shop)/products' }])
  })

  it('the plain, non-nested case still parses exactly as before', () => {
    const result = parsePRDForBuildSteps('1. **Homepage** (/)\n- Blog Detail (/blog/:slug)\n2. About Page (/about)')
    expect(result.pages).toEqual([
      { name: 'Homepage', route: '/' },
      { name: 'Blog Detail', route: '/blog/:slug' },
      { name: 'About Page', route: '/about' },
    ])
  })

  it('multiple nested-paren page lines in the same PRD are each found on their own line (no lastIndex/line skipping)', () => {
    const prd = [
      '1. **Pricing (Plans)** (/pricing)',
      '2. **About Us (Our Story)** (/about)',
      '3. **Shop Page** (/(shop)/products)',
    ].join('\n')
    const result = parsePRDForBuildSteps(prd)
    expect(result.pages).toEqual([
      { name: 'Pricing (Plans)', route: '/pricing' },
      { name: 'About Us (Our Story)', route: '/about' },
      { name: 'Shop Page', route: '/(shop)/products' },
    ])
  })

  it('a parenthetical note with no real route is still correctly ignored', () => {
    const result = parsePRDForBuildSteps('- Pricing Page (see details)')
    expect(result.pages).toEqual([])
  })
})
