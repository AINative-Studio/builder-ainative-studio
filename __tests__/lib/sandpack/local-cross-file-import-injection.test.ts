import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real bug found live (#1099 item 4, chatId -TRhRDvEXrmh-eQBF0zGr):
 * /src/components/Icons.tsx genuinely defines and exports `LoginIcon`, but
 * /src/components/HowItWorks.tsx uses `<LoginIcon size={28} />` in JSX
 * without ever importing it. Unlike the #1122 missing-file case, the file
 * genuinely exists — stubMissingLocalComponents() never sees a broken
 * import specifier because there isn't one. Error: `LoginIcon is not
 * defined`, crashing the whole preview.
 */
describe('buildSandpackFiles — injects a missing import for a locally-defined sibling component used in JSX (#1099 item 4)', () => {
  it('injects the import when a sibling exports the component but the using file never imports it', () => {
    const built = buildSandpackFiles({
      '/src/App.tsx': "import HowItWorks from './components/HowItWorks'\nexport default function App(){ return <HowItWorks/> }",
      '/src/components/Icons.tsx': [
        "import React from 'react'",
        "import { User } from 'lucide-react'",
        "export const LoginIcon: React.FC<{ size?: number }> = (props) => <User {...props} />;",
      ].join('\n'),
      '/src/components/HowItWorks.tsx': [
        "import React from 'react'",
        "export default function HowItWorks() {",
        "  return (<div><LoginIcon size={28} /></div>)",
        "}",
      ].join('\n'),
    })

    expect(built['/src/components/HowItWorks.tsx']).toContain("import { LoginIcon } from './Icons'")
  })

  it('does not inject when the component is already imported', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Widget/> }",
      '/components/Shared.tsx': "export const Widget = () => <div>w</div>",
      '/components/Other.tsx': [
        "import { Widget } from './Shared'",
        "export default function Other() { return <Widget/> }",
      ].join('\n'),
    })

    const occurrences = (built['/components/Other.tsx'].match(/from '\.\/Shared'/g) || []).length
    expect(occurrences).toBe(1)
  })

  it('never injects a self-import for a file using its own exported component', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "import Card from './components/Card'\nexport default function App(){ return <Card/> }",
      '/components/Card.tsx': [
        "export const CardHeader = () => <div>h</div>",
        "export default function Card() { return (<div><CardHeader/></div>) }",
      ].join('\n'),
    })

    expect(built['/components/Card.tsx']).not.toMatch(/import\s*\{\s*CardHeader\s*\}\s*from\s*'\.\/Card'/)
  })

  it('does not guess when the same name is exported from two different files', () => {
    const built = buildSandpackFiles({
      '/App.tsx': "export default function App(){ return <Badge/> }",
      '/components/A.tsx': "export const Badge = () => <span>a</span>",
      '/components/B.tsx': "export const Badge = () => <span>b</span>",
    })

    expect(built['/App.tsx']).not.toContain("from './components/A'")
    expect(built['/App.tsx']).not.toContain("from './components/B'")
  })
})
