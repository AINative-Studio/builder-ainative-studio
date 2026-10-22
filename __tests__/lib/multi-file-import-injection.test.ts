import { describe, it, expect } from 'vitest'
import { parseMultiFileOutput } from '@/lib/multi-file-parser'

const strictParses = (code: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@babel/parser').parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
    return true
  } catch {
    return false
  }
}

/**
 * builder#64 true root cause: injectMissingImports re-added names (LineChart,
 * BarChart, PieChart exist in BOTH lucide-react and recharts) that were already
 * imported from another module, producing "Identifier 'X' has already been
 * declared" in Sandpack — downstream of the code-validator's de-dupe.
 */
describe('multi-file import injection: no cross-module duplicates (#64)', () => {
  it('does not re-inject a name already imported from recharts', () => {
    const raw = [
      "import React from 'react'",
      "import { ResponsiveContainer, LineChart, Line, BarChart, Bar } from 'recharts'",
      'export default function App(){',
      '  return <div><LineChart><Line/></LineChart><BarChart><Bar/></BarChart></div>;',
      '}',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(
      /import\s*\{[^}]*\bLineChart\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(app),
    ).toBe(false)
    expect(strictParses(app)).toBe(true)
  })

  it('does not re-inject an AIKit component already imported', () => {
    const raw = [
      "import React from 'react'",
      "import { MetricCard } from './components/aikit'",
      'export default function App(){ return <MetricCard/>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    // MetricCard must be imported exactly once
    const count = (app.match(/\bMetricCard\b(?=[\s,}])/g) || []).length
    expect(count).toBe(1)
    expect(strictParses(app)).toBe(true)
  })

  it('still injects genuinely-missing lucide icons', () => {
    const raw = [
      "import React from 'react'",
      'export default function App(){ return <div><Search/><Bell/></div>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(/from ['"]lucide-react['"]/.test(app)).toBe(true)
    expect(strictParses(app)).toBe(true)
  })

  // professional-prompt.ts tells the model VideoPlayer/StreamingText/MediaGallery
  // are valid AIKit primitives (and even imports them itself in its own example
  // at line 386) but AIKIT_COMPONENTS was missing all three, so a sub-component
  // file using them with no explicit import sailed through generation unfixed
  // and broke at render time with "X is not defined".
  it('injects missing imports for VideoPlayer, StreamingText, and MediaGallery', () => {
    const raw = [
      "import React from 'react'",
      'export default function App(){',
      '  return <div><VideoPlayer src="a.mp4"/><StreamingText text="hi"/><MediaGallery items={[]}/></div>;',
      '}',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(/import\s*\{[^}]*\bVideoPlayer\b[^}]*\}\s*from\s*['"]\.\/components\/aikit['"]/.test(app)).toBe(true)
    expect(/import\s*\{[^}]*\bStreamingText\b[^}]*\}\s*from\s*['"]\.\/components\/aikit['"]/.test(app)).toBe(true)
    expect(/import\s*\{[^}]*\bMediaGallery\b[^}]*\}\s*from\s*['"]\.\/components\/aikit['"]/.test(app)).toBe(true)
    expect(strictParses(app)).toBe(true)
  })

  // The rendered per-file code is sanitized after injection, so pre-existing
  // per-file defects (multi-line duplicate imports, stray-semicolon arrows) are
  // repaired before reaching Sandpack (builder#64 — found in live 5-run E2E).
  it('repairs a multi-line duplicate import in the rendered file', () => {
    const raw = [
      "import React from 'react'",
      "import { Button } from './b';",
      'import {',
      '  Card,',
      '  CardHeader,',
      "} from './c';",
      "import { Card } from './aikit';", // duplicate Card
      'export default function App(){ return <Card><CardHeader/><Button/></Card>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(strictParses(app)).toBe(true)
    // default+named on the react line must remain intact (no line-swallowing)
    expect(app).toMatch(/import React from 'react'/)
  })

  it('repairs a stray-semicolon arrow (=> (;) in the rendered file', () => {
    const raw = [
      'export default function App(){',
      '  const badge = (l) => (;',
      '    <span>{l}</span>',
      '  );',
      "  return <div>{badge('x')}</div>;",
      '}',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(strictParses(app)).toBe(true)
  })

  it('preserves a default+named import (React, { useState })', () => {
    const raw = [
      "import React, { useState } from 'react'",
      'export default function App(){ const [n]=useState(0); return <div>{n}</div>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(strictParses(app)).toBe(true)
    expect(app).toMatch(/import React, \{ useState \} from 'react'/)
  })

  // The prompt tells the model to use "Re"-prefixed recharts aliases and to
  // treat lucide icons as globally available — the injector must resolve both
  // or they render as "X is not defined" (builder#64 — found in live E2E).
  it('imports a "Re"-prefixed recharts alias (ReLineChart) with an as-alias', () => {
    const raw = [
      "import React from 'react'",
      "import { ResponsiveContainer, Line } from 'recharts'",
      'export default function App(){ return <ResponsiveContainer><ReLineChart data={[]}><Line/></ReLineChart></ResponsiveContainer>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(/LineChart as ReLineChart/.test(app)).toBe(true)
    expect(strictParses(app)).toBe(true)
  })

  it('merges a used-but-unimported lucide icon into the imports', () => {
    const raw = [
      "import React from 'react'",
      "import { Search, Bell } from 'lucide-react'",
      'export default function App(){ return <div><Search/><Bell/><Check/></div>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(/import\s*\{[^}]*\bCheck\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(app)).toBe(true)
    expect(strictParses(app)).toBe(true)
  })

  it('does not duplicate an already-imported recharts real name', () => {
    const raw = [
      "import React from 'react'",
      "import { LineChart, Line } from 'recharts'",
      'export default function App(){ return <LineChart><Line/></LineChart>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(strictParses(app)).toBe(true)
    expect((app.match(/import[^\n]*\bLineChart\b/g) || []).length).toBe(1)
  })
})

/**
 * Issue #1087 (real production bug, found live on
 * https://builder.ainative.studio/build/wallkind-product, 2026-10-13):
 * injectMissingImports only auto-injects missing AIKit, recharts, and
 * lucide-react imports — it has NO handling for shadcn/ui components
 * (Button, Card, Badge, Input, Select, etc). Confirmed with the real, durable
 * generation data (chatId z4nabGqvy_UURyaKnCY8J, fetched via
 * /api/generation/{chatId}/files): the stored /src/components/WallGrid.tsx
 * uses <Button>, <Card>, <CardContent>, <Badge>, <Input>, <Select> etc. as
 * JSX but only imports from 'lucide-react' and 'react' — no './components/
 * ui/*' import exists anywhere in the file. This is what the public preview
 * showed as a Sandpack "Could not find module in path: './components/ui/
 * button'" error: the client-side safety net in components/chat/
 * sandpack-preview.tsx DOES correctly compute the missing shadcn imports at
 * render time, but that's an unreliable last line of defense (confirmed live
 * — the same page errored via Sandpack on repeated loads and only rendered
 * via the iframe/Babel fallback intermittently). Fixing this at the real
 * source — generation time, server-side, same place AIKit/recharts/lucide
 * are already handled — matches this repo's own stated contract philosophy
 * (docs/design/COMPONENT_IMPORT_CONTRACT.md: stop the defect at generation
 * time, not render time).
 */
describe('multi-file import injection: shadcn/ui components (#1087)', () => {
  it('injects missing shadcn/ui imports for Button/Card/Badge/Input/Select — the real wallkind WallGrid.tsx shape', () => {
    const raw = [
      "import { Search, Trash2, Layout, Grid } from 'lucide-react'",
      "import React, { useState } from 'react'",
      'export default function WallGrid({ walls }) {',
      '  return (',
      '    <div>',
      '      <Input placeholder="Search walls..." />',
      '      <Select value="all">',
      '        <SelectTrigger><SelectValue /></SelectTrigger>',
      '        <SelectContent><SelectItem value="all">All</SelectItem></SelectContent>',
      '      </Select>',
      '      <Card>',
      '        <CardContent>',
      '          <Badge>draft</Badge>',
      '          <Button variant="outline">Publish</Button>',
      '        </CardContent>',
      '      </Card>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect(/import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*['"]\.\/components\/ui\/button['"]/.test(app)).toBe(true)
    expect(/import\s*\{[^}]*\bCard\b[^}]*\bCardContent\b[^}]*\}\s*from\s*['"]\.\/components\/ui\/card['"]/.test(app)).toBe(true)
    expect(/import\s*\{[^}]*\bBadge\b[^}]*\}\s*from\s*['"]\.\/components\/ui\/badge['"]/.test(app)).toBe(true)
    expect(/import\s*\{[^}]*\bInput\b[^}]*\}\s*from\s*['"]\.\/components\/ui\/input['"]/.test(app)).toBe(true)
    expect(
      /import\s*\{[^}]*\bSelect\b[^}]*\bSelectTrigger\b[^}]*\bSelectValue\b[^}]*\bSelectContent\b[^}]*\bSelectItem\b[^}]*\}\s*from\s*['"]\.\/components\/ui\/select['"]/.test(app),
    ).toBe(true)
    expect(strictParses(app)).toBe(true)
  })

  it('does not re-inject a shadcn component already imported', () => {
    const raw = [
      "import React from 'react'",
      "import { Button } from './components/ui/button'",
      'export default function App(){ return <Button>Go</Button>; }',
    ].join('\n')
    const app = Object.values(parseMultiFileOutput(raw))[0]
    expect((app.match(/\bButton\b(?=[\s,}<])/g) || []).length).toBeLessThanOrEqual(3) // import + JSX open + close tag
    expect((app.match(/from ['"]\.\/components\/ui\/button['"]/g) || []).length).toBe(1)
    expect(strictParses(app)).toBe(true)
  })

  it('a shadcn import for a file nested inside components/ uses a sibling ./ui/ path, not another components/ hop', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react'",
      "import WallGrid from './components/WallGrid'",
      'export default function App(){ return <WallGrid/>; }',
      '// --- FILE: /src/components/WallGrid.tsx ---',
      "import React from 'react'",
      'export default function WallGrid(){ return <Button>Go</Button>; }',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    const wallGrid = files['/src/components/WallGrid.tsx']
    expect(wallGrid).toMatch(/from ['"]\.\/ui\/button['"]/)
    expect(wallGrid).not.toMatch(/from ['"]\.\/components\/ui\/button['"]/)
    expect(strictParses(wallGrid)).toBe(true)
  })
})

/**
 * Real bug (customer-reported, "agentis", 2026-09-10): injectMissingImports
 * always wrote the SAME hardcoded 'from ./components/aikit' into EVERY file,
 * regardless of where that file actually lives in the tree. That's only
 * correct for a file at the project root (e.g. /src/App.tsx) — a file the
 * model placed INSIDE components/ itself needs a SIBLING import ('./aikit'),
 * not another './components/' hop. The exact reported error:
 * "Could not find module in path: './components/aikit' relative to
 * '/components/Header.tsx'" — Sandpack was looking for a nonexistent nested
 * components/components/aikit. Now computed per-file from that file's own
 * path depth (parseMultiFileOutput passes each file's real path through).
 */
describe('multi-file import injection: components/ import path resolves per-file depth (2026-09-10)', () => {
  it('a file living INSIDE components/ gets a sibling import, not another components/ hop', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react'",
      "import Header from './components/Header'",
      'export default function App(){ return <Header/>; }',
      '// --- FILE: /src/components/Header.tsx ---',
      "import React from 'react'",
      'export default function Header(){ return <AIKitHeader title="App"/>; }',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    const header = files['/src/components/Header.tsx']
    expect(header).toBeDefined()
    expect(header).toMatch(/from ['"]\.\/aikit['"]/)
    expect(header).not.toMatch(/from ['"]\.\/components\/aikit['"]/)
  })

  it('a root-level file still gets the original ./components/aikit path', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react'",
      'export default function App(){ return <AIKitHeader title="App"/>; }',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    const app = files['/src/App.tsx']
    expect(app).toMatch(/from ['"]\.\/components\/aikit['"]/)
  })

  it('an @/components/ alias inside a components/-nested file also resolves to a sibling import', () => {
    const raw = [
      '// --- FILE: /src/App.tsx ---',
      "import React from 'react'",
      "import Header from './components/Header'",
      'export default function App(){ return <Header/>; }',
      '// --- FILE: /src/components/Header.tsx ---',
      "import React from 'react'",
      "import { Button } from '@/components/ui/button'",
      'export default function Header(){ return <Button/>; }',
    ].join('\n')
    const files = parseMultiFileOutput(raw)
    const header = files['/src/components/Header.tsx']
    expect(header).toMatch(/from ['"]\.\/ui\/button['"]/)
  })
})
