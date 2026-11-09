import { describe, it, expect } from 'vitest'
import { sanitizeForSandpack } from '@/lib/code-validator'

/**
 * Regression: autoFixCode's mobile-responsiveness fixes (builder#196,
 * "MOBILE OVERFLOW" / "MOBILE GRID" / "MOBILE MIN-WIDTH", plus the
 * RESPONSIVE FLOOR block's own grid/heading rewrite steps, builder#188) used
 * to run their `w-[NNNpx]` / `grid-cols-N` / `min-w-[NNNpx]` / `text-Nxl`
 * regexes against the WHOLE raw file instead of scoping to literal
 * `className="..."` values — unlike the sibling MOBILE FLEX ROW fix, which
 * already scoped itself correctly. A comment or on-page copy that merely
 * MENTIONS a matching utility class (a CSS-tutorial/design-tool landing page
 * explaining its own grid/width/heading classes to visitors) got silently
 * rewritten into nonsense visible text or comment content, even though it
 * was never a real className at all.
 */

describe('mobile-responsiveness fixes are scoped to className values (builder#196/#188)', () => {
  it('does not rewrite grid-cols-N mentioned in a comment or rendered text', () => {
    const code = [
      '// Try grid-cols-3 for a nice three-column layout on desktop.',
      'export default function App() {',
      '  return (',
      '    <div>',
      '      <p>Pro tip: use grid-cols-4 in your own CSS for dashboards.</p>',
      '      <div className="grid grid-cols-1 gap-4"><div>Card 1</div></div>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('// Try grid-cols-3 for a nice three-column layout on desktop.')
    expect(fixed).toContain('Pro tip: use grid-cols-4 in your own CSS for dashboards.')
  })

  it('still rewrites a real bare grid-cols-N className into a responsive mobile base', () => {
    const code = [
      'export default function App() {',
      '  return <div className="grid grid-cols-3 gap-4"><div>A</div><div>B</div><div>C</div></div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('grid-cols-1 md:grid-cols-3')
  })

  it('does not rewrite min-w-[NNNpx] mentioned in rendered text', () => {
    const code = [
      'export default function App() {',
      '  return <div><p>Our sidebar uses min-w-[400px] in the source if you want to copy it.</p></div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('Our sidebar uses min-w-[400px] in the source if you want to copy it.')
  })

  it('still rewrites a real oversized min-w-[NNNpx] className', () => {
    const code = [
      'export default function App() {',
      '  return <div className="min-w-[500px]">Sidebar</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('min-w-0 md:min-w-[500px]')
  })

  it('does not rewrite w-[NNNpx] mentioned in rendered text', () => {
    const code = [
      'export default function App() {',
      '  return <div><p>Set your hero to w-[500px] if you want a fixed width.</p></div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('Set your hero to w-[500px] if you want a fixed width.')
  })

  it('still rewrites a real oversized w-[NNNpx] className', () => {
    const code = [
      'export default function App() {',
      '  return <div className="w-[500px]">Hero</div>',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain('w-full max-w-[500px]')
  })

  it('RESPONSIVE FLOOR block does not rewrite grid-cols-N or text-Nxl mentioned only in prose/comments', () => {
    const code = [
      '// our design system uses text-6xl for hero headings and grid-cols-4 for dashboards',
      'export default function App() {',
      '  return (',
      '    <div className="flex">',
      '      <div className="grid"><div>A</div></div>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const fixed = sanitizeForSandpack(code)
    expect(fixed).toContain(
      '// our design system uses text-6xl for hero headings and grid-cols-4 for dashboards',
    )
  })
})
