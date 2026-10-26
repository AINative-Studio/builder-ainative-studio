import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * #1527 — buildPreviewHtml() ran its own narrow, ad-hoc 4-regex component-name
 * detector, the same bug class as #1523: none of those regexes matched an
 * ANONYMOUS default export (`export default () => {}`, `export default class
 * extends X {}`) — a common shape in generated showcase entries. When none
 * matched, componentName fell back to the literal string 'App', which doesn't
 * exist anywhere in the generated code. The compiled preview embeds
 * `typeof App !== "undefined" ? App : null`, which then always evaluated to
 * null — the showcase preview iframe rendered blank for any such entry.
 *
 * Migrated to the shared, already-tested lib/component-detector.ts's
 * detectRootComponent() (same detector lib/code-validator.ts and
 * app/api/preview/[id]/route.ts already use), applying its `rewrite`
 * instruction for anonymous exports BEFORE the generic `export default`
 * strip — the same proven pattern as the preview route.
 */
describe('buildPreviewHtml component detection (#1527)', () => {
  it('detects a named function default export', () => {
    const code = `
      export default function Dashboard() {
        return <div>dashboard</div>
      }
    `
    const html = buildPreviewHtml(code)
    expect(html).toContain('typeof Dashboard !== "undefined" ? Dashboard : null')
  })

  it('detects a named class default export', () => {
    const code = `
      export default class GalaxyMap extends React.Component {
        render() { return <div>map</div> }
      }
    `
    const html = buildPreviewHtml(code)
    expect(html).toContain('typeof GalaxyMap !== "undefined" ? GalaxyMap : null')
  })

  it('#1527: detects an anonymous arrow default export (previously fell back to the nonexistent "App")', () => {
    const code = `
      const App = () => {
        return <div>anon arrow</div>
      }
      export default App
    `
    // Deliberately testing the TRULY anonymous shape the old regexes missed:
    const anonCode = `export default () => (\n  <section>anon arrow</section>\n)`
    const html = buildPreviewHtml(anonCode)
    expect(html).not.toContain('typeof App !== "undefined" ? App : null')
    expect(html).toMatch(/typeof __PreviewDefault !== "undefined" \? __PreviewDefault : null/)
    // The rewrite must have actually renamed the declaration in the embedded script, not just the trailer.
    expect(html).toContain('const __PreviewDefault = ')
  })

  it('#1527: detects an anonymous class default export (plain extends target)', () => {
    // Intentionally a plain identifier, not a dotted one (React.Component) —
    // the dotted-extends-target case depends on #1524's fix to
    // lib/component-detector.ts landing first; this test exercises #1527's
    // migration itself without coupling to that separate fix/merge order.
    const code = `export default class extends Component {\n  render() { return <div>anon class</div> }\n}`
    const html = buildPreviewHtml(code)
    expect(html).toMatch(/typeof __PreviewDefault !== "undefined" \? __PreviewDefault : null/)
    expect(html).toContain('class __PreviewDefault extends Component {')
  })

  it('falls back to App only when there genuinely is no detectable component', () => {
    const code = `const x = 1 + 1;`
    const html = buildPreviewHtml(code)
    expect(html).toContain('typeof App !== "undefined" ? App : null')
  })
})
