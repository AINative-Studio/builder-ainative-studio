import { describe, it, expect } from 'vitest'
import { buildPreviewHtml } from '@/app/showcase/showcase-client'

/**
 * showcase-client.tsx's buildPreviewHtml() used to run its own narrower
 * 4-regex component-name detector before migrating to the shared
 * lib/component-detector.ts detectRootComponent() (#1523). That old detector
 * only matched a NAMED default export (`export default function Foo` /
 * `export default Foo`); an anonymous arrow or class default export fell
 * through to the literal fallback 'App', which never exists in the
 * generated code, so the embedded
 * `typeof App !== "undefined" ? App : null` guard always returned null and
 * the showcase preview rendered blank.
 */
describe('showcase-client buildPreviewHtml component detection', () => {
  it('finds the component name for a named function default export', () => {
    const html = buildPreviewHtml('export default function LandingPage() { return <div>hi</div> }')
    expect(html).toContain('typeof LandingPage !== "undefined" ? LandingPage : null')
  })

  it('finds the component name for a named class default export', () => {
    const html = buildPreviewHtml(
      'export default class LandingPage extends React.Component { render() { return <div>hi</div> } }'
    )
    expect(html).toContain('typeof LandingPage !== "undefined" ? LandingPage : null')
  })

  it('synthesizes and binds a name for an anonymous arrow default export', () => {
    const html = buildPreviewHtml('export default () => { return <div>hi</div> }')
    expect(html).toContain('typeof __PreviewDefault !== "undefined" ? __PreviewDefault : null')
    // The rewrite must turn the arrow into a bound declaration, not leave it
    // as a dangling (and therefore unbound) expression statement.
    expect(html).toContain('const __PreviewDefault = () => { return <div>hi</div> }')
  })

  it('synthesizes and binds a name for an anonymous class default export', () => {
    const html = buildPreviewHtml(
      'export default class extends Component { render() { return <div>hi</div> } }'
    )
    expect(html).toContain('typeof __PreviewDefault !== "undefined" ? __PreviewDefault : null')
    expect(html).toContain('class __PreviewDefault extends Component {')
  })

  it('falls back to App only when genuinely no component is detectable', () => {
    const html = buildPreviewHtml('const x = 1;')
    expect(html).toContain('typeof App !== "undefined" ? App : null')
  })
})
