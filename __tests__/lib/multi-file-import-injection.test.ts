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
})
