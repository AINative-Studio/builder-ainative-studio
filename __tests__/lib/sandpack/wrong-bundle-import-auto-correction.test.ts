import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Regression for #2016, found live on real registered company "brambleworks"
 * (chatId abhH0__eEeOeiZfsggnIk): its `src/App.tsx` imports `AIKitBanner`
 * from './components/ui' — the shadcn barrel — while `AIKitBanner` is only
 * ever exported by the aikit bundle. The AIKit/shadcn auto-import safety
 * nets' "already imported" guard only tested whether the identifier appeared
 * somewhere between `import` and `from`, so the wrong-bundle import
 * satisfied it, the correction never ran, and Sandpack shipped an
 * unresolvable import (`AIKitBanner` undefined at its JSX usage site).
 */
describe('buildSandpackFiles — wrong-bundle import no longer defeats auto-correction', () => {
  it('rewrites an AIKit component imported from the shadcn barrel to the aikit bundle', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { AIKitBanner } from './components/ui'",
        'export default function App(){ return <AIKitBanner /> }',
      ].join('\n'),
    })
    const app = built['/App.tsx']
    expect(app).toContain("import { AIKitBanner } from './components/aikit'")
    expect(app).not.toMatch(/import \{[^}]*AIKitBanner[^}]*\} from '\.\/components\/ui'/)
  })

  it('keeps the other names on a mixed wrong-path import, each from its real bundle', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { AIKitBanner, Button } from './components/ui'",
        'export default function App(){ return <div><AIKitBanner /><Button /></div> }',
      ].join('\n'),
    })
    const app = built['/App.tsx']
    expect(app).toContain("import { AIKitBanner } from './components/aikit'")
    expect(app).toContain("import { Button } from './components/ui/button'")
    expect(app).not.toMatch(/from '\.\/components\/ui'/)
  })

  it('rewrites a shadcn component imported from the wrong shadcn submodule', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { Separator } from './components/ui/badge'",
        'export default function App(){ return <Separator /> }',
      ].join('\n'),
    })
    const app = built['/App.tsx']
    expect(app).toContain("import { Separator } from './components/ui/separator'")
    expect(app).not.toMatch(/import \{[^}]*Separator[^}]*\} from '\.\/components\/ui\/badge'/)
  })

  it('leaves a correct import alone (no duplicate injection)', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { Button } from './components/ui/button'",
        'export default function App(){ return <Button /> }',
      ].join('\n'),
    })
    const app = built['/App.tsx']
    expect(app.match(/import \{[^}]*\bButton\b[^}]*\} from/g) || []).toHaveLength(1)
    expect(app).toContain("import { Button } from './components/ui/button'")
  })

  it('leaves Skeleton alone when imported from either bundle that really exports it', () => {
    const fromShadcn = buildSandpackFiles({
      '/App.tsx': [
        "import { Skeleton } from './components/ui/skeleton'",
        'export default function App(){ return <Skeleton /> }',
      ].join('\n'),
    })['/App.tsx']
    expect(fromShadcn).toContain("import { Skeleton } from './components/ui/skeleton'")
    expect(fromShadcn).not.toContain("from './components/aikit'")

    const fromAikit = buildSandpackFiles({
      '/App.tsx': [
        "import { Skeleton } from './components/aikit'",
        'export default function App(){ return <Skeleton /> }',
      ].join('\n'),
    })['/App.tsx']
    expect(fromAikit).toContain("import { Skeleton } from './components/aikit'")
    expect(fromAikit).not.toContain("from './components/ui/skeleton'")
  })

  it('does not touch a wrong-path import for a component that is never rendered', () => {
    const built = buildSandpackFiles({
      '/App.tsx': [
        "import { AIKitBanner } from './components/ui'",
        'export default function App(){ return <div>no banner here</div> }',
      ].join('\n'),
    })
    expect(built['/App.tsx']).toContain("import { AIKitBanner } from './components/ui'")
  })
})
