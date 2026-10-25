import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * issue #1523 (same root bug class as #1498/#1506/#1515/#1517/#1519): the
 * showcase page's own component-name detection predated and duplicated
 * lib/component-detector.ts's `detectRootComponent()`, with a narrower
 * bare-identifier regex that required an uppercase first character but never
 * special-cased `class`. For a class-exported or anonymous component it
 * silently fell back to the literal string 'App', so the generated preview
 * script checked `typeof App` instead of the component's real name and
 * rendered the generic "Preview" placeholder instead of the actual component.
 *
 * These tests pin that `buildPreviewHtml()` now resolves the real component
 * name (and, for anonymous exports, applies detectRootComponent's rewrite)
 * for every shape detectRootComponent already covers.
 */
describe('buildPreviewHtml component-name detection', () => {
  it('resolves a named function default export (regression guard)', () => {
    const html = buildPreviewHtml(`
      export default function InvoiceWizard() {
        return <div>hi</div>
      }
    `)
    expect(html).toContain('typeof InvoiceWizard !== "undefined" ? InvoiceWizard : null')
    expect(html).toContain('function InvoiceWizard()')
  })

  it('resolves a named class default export instead of falling back to App', () => {
    const html = buildPreviewHtml(`
      export default class GalaxyMap extends React.Component {
        render() { return <div /> }
      }
    `)
    expect(html).toContain('typeof GalaxyMap !== "undefined" ? GalaxyMap : null')
    expect(html).toContain('class GalaxyMap extends React.Component')
    expect(html).not.toContain('typeof App !== "undefined"')
  })

  it('resolves a bare-identifier default export without capturing it as App', () => {
    const html = buildPreviewHtml(`
      function Dashboard() { return <div /> }
      export default Dashboard
    `)
    expect(html).toContain('typeof Dashboard !== "undefined" ? Dashboard : null')
  })

  it('applies the rewrite for an anonymous arrow default export', () => {
    const html = buildPreviewHtml(`
      export default () => <div>anon</div>
    `)
    expect(html).toContain('typeof __PreviewDefault !== "undefined" ? __PreviewDefault : null')
    expect(html).toContain('const __PreviewDefault = ')
  })

  it('applies the rewrite for an anonymous class default export', () => {
    const html = buildPreviewHtml(`
      export default class extends React.Component {
        render() { return <div /> }
      }
    `)
    expect(html).toContain('typeof __PreviewDefault !== "undefined" ? __PreviewDefault : null')
    expect(html).toContain('class __PreviewDefault extends React.Component')
  })

  it('falls back to App only when genuinely no component can be found', () => {
    const html = buildPreviewHtml(`
      const notAComponent = 42
    `)
    expect(html).toContain('typeof App !== "undefined" ? App : null')
  })
})
