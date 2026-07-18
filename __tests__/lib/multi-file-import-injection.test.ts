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
