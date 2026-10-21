import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real bug found live (#1099 item 8, chatId giaQamGeJTIlfG-xfxqY7): a
 * generation can produce only sibling component files (plus scaffold
 * files like robots.txt/sitemap.xml) with no App.tsx/src/App.tsx/page.tsx
 * anywhere. Previously, buildSandpackFiles()'s entry-point fallback
 * (`Object.keys(sandpackFiles)[0]`) picked an arbitrary BUILTIN file
 * (shadcn/AIKit/template get spread into sandpackFiles first), producing
 * nonsense `/App.tsx` content and a raw babel parse error instead of a
 * clear message.
 */
describe('buildSandpackFiles — graceful fallback when no entry point was generated (#1099 item 8)', () => {
  it('renders a clear placeholder instead of an arbitrary builtin file when no App.tsx/page.tsx exists', () => {
    const built = buildSandpackFiles({
      '/src/components/MailOrder.tsx': "export default function MailOrder(){ return <div>hi</div> }",
    })

    expect(built['/App.tsx']).toContain('export default function App')
    expect(built['/App.tsx']).toContain("hasn't been generated yet")
    // Must not have silently become some unrelated builtin's own content.
    expect(built['/App.tsx']).not.toContain('MailOrder')
  })

  it('still assembles the real entry point normally when one exists', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': "export default function App(){ return <div>real</div> }",
    })
    expect(built['/App.tsx']).toContain('real')
    expect(built['/App.tsx']).not.toContain("hasn't been generated yet")
  })
})
