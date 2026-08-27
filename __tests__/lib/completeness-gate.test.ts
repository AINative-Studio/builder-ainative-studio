import { describe, it, expect } from 'vitest'
import { findMissingLocalImports } from '@/lib/build/completeness-gate'

/**
 * builder#333 — completeness gate detector.
 *
 * A truncated multi-file generation (beacon repro: App imports Analytics but the
 * stream was cut before Analytics was emitted) parses file-by-file yet is
 * unshippable. findMissingLocalImports must flag exactly the local imports with
 * no definition in the payload — and NOTHING else (npm/asset/type/side-effect
 * imports, runtime-provided AIKit/shadcn modules, resolvable files).
 */

describe('findMissingLocalImports — files map mode', () => {
  it('returns [] for a complete multi-file app (default imports, no extensions)', () => {
    const files = {
      '/src/App.tsx': `import Sidebar from './components/Sidebar'\nimport Header from './components/Header'\nexport default function App(){ return <div><Sidebar/><Header/></div> }`,
      '/src/components/Sidebar.tsx': `export default function Sidebar(){ return <aside/> }`,
      '/src/components/Header.tsx': `export default function Header(){ return <header/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('flags a default import whose file was never emitted (beacon class)', () => {
    const files = {
      '/src/App.tsx': `import Sidebar from './components/Sidebar'\nimport Analytics from './components/Analytics'\nexport default function App(){ return <div><Sidebar/><Analytics/></div> }`,
      '/src/components/Sidebar.tsx': `export default function Sidebar(){ return <aside/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual(['./components/Analytics'])
  })

  it('flags named imports from a missing file', () => {
    const files = {
      '/src/App.tsx': `import { ScheduledPosts, SocialListening } from './components/Panels'\nexport default function App(){ return <ScheduledPosts/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual(['./components/Panels'])
  })

  it('resolves imports written WITH an extension', () => {
    const files = {
      '/src/App.tsx': `import Sidebar from './components/Sidebar.tsx'\nexport default function App(){ return <Sidebar/> }`,
      '/src/components/Sidebar.tsx': `export default function Sidebar(){ return <aside/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('resolves ../ parent-relative imports', () => {
    const files = {
      '/src/components/Card.tsx': `import { fmt } from '../lib/format'\nexport default function Card(){ return <div>{fmt(1)}</div> }`,
      '/src/lib/format.ts': `export const fmt = (n: number) => String(n)`,
    }
    expect(findMissingLocalImports('', files)).toEqual([])
  })

  it('flags a broken ../ import', () => {
    const files = {
      '/src/components/Card.tsx': `import { fmt } from '../lib/format'\nexport default function Card(){ return <div/> }`,
    }
    expect(findMissingLocalImports('', files)).toEqual(['../lib/format'])
  })

  it('resolves directory imports via index files', () => {
    const files = {
      '/src/App.tsx': `import { Button } from './components'\nexport default function App(){ return <Button/> }`,
      '/src/components/index.tsx': `export const Button = () => <button/>`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('tolerates src/-prefix mismatch (Sandpack duplicates /src/* at root)', () => {
    const files = {
      '/src/App.tsx': `import Header from './components/Header'\nexport default function App(){ return <Header/> }`,
      '/components/Header.tsx': `export default function Header(){ return <header/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('accepts a missing file when the imported identifier is defined inline elsewhere', () => {
    const files = {
      '/src/App.tsx': `import Sidebar from './components/Sidebar'\nfunction Sidebar(){ return <aside/> }\nexport default function App(){ return <Sidebar/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })

  it('flags namespace imports of a missing file', () => {
    const files = {
      '/src/App.tsx': `import * as Charts from './charts'\nexport default function App(){ return <Charts.Line/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual(['./charts'])
  })

  it('flags mixed default+named imports when the file is missing', () => {
    const files = {
      '/src/App.tsx': `import Grid, { Row as GridRow } from './layout/Grid'\nexport default function App(){ return <Grid><GridRow/></Grid> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual(['./layout/Grid'])
  })

  it('checks imports in EVERY source file, not just the entry', () => {
    const files = {
      '/src/App.tsx': `import Dash from './components/Dash'\nexport default function App(){ return <Dash/> }`,
      '/src/components/Dash.tsx': `import Chart from './Chart'\nexport default function Dash(){ return <Chart/> }`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual(['./Chart'])
  })
})

describe('findMissingLocalImports — ignored import classes', () => {
  const app = (imports: string) =>
    `${imports}\nexport default function App(){ return <div/> }`

  it('ignores npm imports (bare and scoped)', () => {
    const code = app(
      `import React, { useState } from 'react'\nimport { LineChart } from 'recharts'\nimport { Search } from 'lucide-react'\nimport ns from '@scope/pkg'`,
    )
    expect(findMissingLocalImports(code, { '/src/App.tsx': code })).toEqual([])
  })

  it('ignores style/asset imports', () => {
    const code = app(`import './globals.css'\nimport logo from './logo.svg'\nimport data from './data.json'`)
    expect(findMissingLocalImports(code, { '/src/App.tsx': code })).toEqual([])
  })

  it('ignores type-only imports', () => {
    const code = app(`import type { Task } from './types'\nimport { type Row } from './models'`)
    expect(findMissingLocalImports(code, { '/src/App.tsx': code })).toEqual([])
  })

  it('ignores runtime-provided AIKit and shadcn modules', () => {
    const code = app(
      `import { MetricCard } from './components/aikit'\nimport { Button } from './components/ui/button'\nimport { cn } from '../lib/utils'\nimport { Card } from '@/components/ui/card'`,
    )
    expect(findMissingLocalImports(code, { '/src/App.tsx': code })).toEqual([])
  })

  it('ignores bare side-effect imports of code files', () => {
    const code = app(`import './setup'`)
    expect(findMissingLocalImports(code, { '/src/App.tsx': code })).toEqual([])
  })

  it('does not scan non-code files for imports', () => {
    const files = {
      '/src/App.tsx': `export default function App(){ return <div/> }`,
      '/public/llms.txt': `import Ghost from './components/Ghost'`,
    }
    expect(findMissingLocalImports(files['/src/App.tsx'], files)).toEqual([])
  })
})

describe('findMissingLocalImports — concatenated blob mode (no files map)', () => {
  it('accepts a single-file blob with no local imports', () => {
    const code = `import { useState } from 'react'\nexport default function App(){ return <div/> }`
    expect(findMissingLocalImports(code)).toEqual([])
  })

  it('accepts a blob where the imported component is defined inline (flatten-safe)', () => {
    const code = `import Sidebar from './components/Sidebar'\nfunction Sidebar(){ return <aside/> }\nexport default function App(){ return <Sidebar/> }`
    expect(findMissingLocalImports(code)).toEqual([])
  })

  it('flags a blob importing a component with NO definition anywhere', () => {
    const code = `import Analytics from './components/Analytics'\nexport default function App(){ return <Analytics/> }`
    expect(findMissingLocalImports(code)).toEqual(['./components/Analytics'])
  })

  it('accepts const-arrow and class definitions as satisfying imports', () => {
    const code = [
      `import Chart from './Chart'`,
      `import Panel from './Panel'`,
      `const Chart = () => <svg/>`,
      `class Panel extends React.Component { render(){ return <div/> } }`,
      `export default function App(){ return <><Chart/><Panel/></> }`,
    ].join('\n')
    expect(findMissingLocalImports(code)).toEqual([])
  })

  it('BEACON REPRO (chatId x-eTnc7qjv_AYvQFucUvH): multi-file blob truncated mid-stream — Analytics imported, never defined', () => {
    const code = [
      `// --- FILE: src/App.tsx ---`,
      `import Sidebar from './components/Sidebar'`,
      `import Header from './components/Header'`,
      `import ComposerSection from './components/ComposerSection'`,
      `import ScheduledPosts from './components/ScheduledPosts'`,
      `import SocialListening from './components/SocialListening'`,
      `import Analytics from './components/Analytics'`,
      `export default function App(){ return <div><Sidebar/><Header/><ComposerSection/><ScheduledPosts/><SocialListening/><Analytics/></div> }`,
      `// --- FILE: src/components/Sidebar.tsx ---`,
      `export default function Sidebar(){ return <aside/> }`,
      `// --- FILE: src/components/Header.tsx ---`,
      `export default function Header(){ return <header/> }`,
      `// --- FILE: src/components/ComposerSection.tsx ---`,
      `export default function ComposerSection(){ return <section/> }`,
      `// --- FILE: src/components/ScheduledPosts.tsx ---`,
      `export default function ScheduledPosts(){ return <ul/> }`,
      `// --- FILE: src/components/SocialListening.tsx ---`,
      `export default function SocialListening(){ return (<div>listening</div>)));`,
      `}`,
      `}`,
    ].join('\n')
    expect(findMissingLocalImports(code)).toEqual(['./components/Analytics'])
  })

  it('accepts a COMPLETE multi-file blob (every imported file section present)', () => {
    const code = [
      `// --- FILE: src/App.tsx ---`,
      `import Sidebar from './components/Sidebar'`,
      `export default function App(){ return <Sidebar/> }`,
      `// --- FILE: src/components/Sidebar.tsx ---`,
      `export default function Sidebar(){ return <aside/> }`,
    ].join('\n')
    expect(findMissingLocalImports(code)).toEqual([])
  })

  it('reports each distinct missing specifier exactly once', () => {
    const code = [
      `// --- FILE: src/App.tsx ---`,
      `import Analytics from './components/Analytics'`,
      `export default function App(){ return <Analytics/> }`,
      `// --- FILE: src/pages/Reports.tsx ---`,
      `import Analytics from '../components/Analytics'`,
      `export default function Reports(){ return <Analytics/> }`,
    ].join('\n')
    const missing = findMissingLocalImports(code)
    expect(missing).toContain('./components/Analytics')
    expect(missing).toContain('../components/Analytics')
    expect(missing).toHaveLength(2)
  })

  it('never throws on garbage input (fail-open)', () => {
    expect(findMissingLocalImports('')).toEqual([])
    expect(findMissingLocalImports('import from from from')).toEqual([])
    expect(findMissingLocalImports(null as unknown as string)).toEqual([])
  })
})
