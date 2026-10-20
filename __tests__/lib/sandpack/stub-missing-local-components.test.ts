import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real bug found live (2026-10-20, Dispatch, chatId pjB5gMxCNJ-2XqyZa7l5l):
 * /src/App.tsx imports './components/Footer', but the generation never
 * produced Footer.tsx — confirmed directly against the real
 * /api/generation/{chatId}/files response, only Header/Hero/Features/
 * HowItWorks/Pricing exist. Sandpack's bundler failed the ENTIRE preview
 * with "Cannot find module '/components/Footer' from '/App.tsx'", even
 * though every other component would have rendered fine.
 */
describe('buildSandpackFiles — stubs a genuinely missing local component instead of crashing the whole preview (#1122)', () => {
  it('synthesizes an inert stub for an imported sibling component file that was never generated', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': [
        "import Header from './components/Header'",
        "import Footer from './components/Footer'",
        'export default function App() {',
        '  return (<div><Header/><Footer/></div>)',
        '}',
      ].join('\n'),
      '/src/components/Header.tsx': "export default function Header(){ return <header>hi</header> }",
    })

    // The real file must never be overwritten by a stub.
    expect(built['/src/components/Header.tsx']).toContain('<header>hi</header>')

    // The missing file must now exist (at the resolved, real-file-sibling
    // path) so Sandpack's bundler can resolve the import.
    expect(built['/src/components/Footer.tsx']).toBeDefined()
    expect(built['/src/components/Footer.tsx']).toContain('export default function Footer')
    expect(built['/src/components/Footer.tsx']).toContain('return null')
  })

  it('does not stub a component that genuinely exists', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import Footer from './components/Footer'\nexport default function App(){ return <Footer/> }",
      '/components/Footer.tsx': "export default function Footer(){ return <footer>real</footer> }",
    })
    expect(built['/components/Footer.tsx']).toContain('<footer>real</footer>')
    expect(built['/components/Footer.tsx']).not.toContain('Auto-stubbed')
  })

  it('never stubs a builtin (shadcn/AIKit) import path — those are real, already-provided files', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import { Button } from './components/ui/button'\nexport default function App(){ return <Button>hi</Button> }",
    })
    expect(built['/components/ui/button.tsx']).toBeDefined()
    expect(built['/components/ui/button.tsx']).not.toContain('Auto-stubbed')
  })
})
