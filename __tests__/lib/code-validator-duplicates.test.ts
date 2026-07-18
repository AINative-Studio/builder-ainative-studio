import { describe, it, expect } from 'vitest'
import {
  validateJavaScriptCode,
  findDuplicateTopLevelDeclaration,
} from '@/lib/code-validator'

/**
 * builder#64 — duplicate top-level declarations (esp. duplicate imports) were
 * silently accepted by the error-recovery Babel parse and logged as 'success',
 * but broke in Sandpack with "Identifier 'X' has already been declared".
 */
describe('code-validator: duplicate declaration handling (#64)', () => {
  it('auto-fixes a duplicate named import across two import lines', () => {
    const code = [
      "import React from 'react'",
      "import { Button } from './components/ui/button'",
      "import { Card, CardHeader, CardTitle } from './components/aikit'",
      "import { Card } from './components/ui/card'", // duplicate Card
      'export default function App() { return <Card><Button /></Card> }',
    ].join('\n')

    const result = validateJavaScriptCode(code)

    expect(result.valid).toBe(true)
    // Only one binding of Card should remain
    const cardBindings = (result.code.match(/\bCard\b(?=[\s,}])/g) || [])
    expect(findDuplicateTopLevelDeclaration(result.code)).toBeNull()
    expect(result.fixes?.some(f => /duplicate import/i.test(f))).toBe(true)
    expect(cardBindings.length).toBeGreaterThan(0)
  })

  it('rejects an unfixable duplicate top-level declaration so retry engages', () => {
    const code = [
      "import { Card } from './ui/card'",
      'const Card = () => <div>shadow</div>;', // conflicts with imported Card
      'export default function App() { return <Card /> }',
    ].join('\n')

    const result = validateJavaScriptCode(code)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Card.*already been declared/i)
  })

  it('detects duplicate top-level function declarations', () => {
    const code = [
      'function Widget() { return null }',
      'function Widget() { return <div/> }',
    ].join('\n')
    expect(findDuplicateTopLevelDeclaration(code)).toBe('Widget')
  })

  it('does NOT flag legitimate repeated names in nested scopes', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const item = 1;',
      '  function inner() { const item = 2; return item; }',
      '  return <div>{item}{inner()}</div>;',
      '}',
    ].join('\n')
    // `item` is declared twice but in different (nested) scopes — only column-0
    // top-level decls are checked, so this must not be flagged.
    expect(findDuplicateTopLevelDeclaration(code)).toBeNull()
    expect(validateJavaScriptCode(code).valid).toBe(true)
  })

  it('passes clean code with no duplicates unchanged', () => {
    const code = [
      "import React from 'react'",
      "import { Button } from './ui/button'",
      "import { Card } from './ui/card'",
      'export default function App() { return <Card><Button /></Card> }',
    ].join('\n')
    const result = validateJavaScriptCode(code)
    expect(result.valid).toBe(true)
    expect(findDuplicateTopLevelDeclaration(result.code)).toBeNull()
  })

  it('does NOT flag repeated imports/names across separate files (multi-file output)', () => {
    const code = [
      '// --- FILE: App.tsx ---',
      "import React from 'react'",
      "import { Card } from './ui/card'",
      'export default function App() { return <Card /> }',
      '// --- FILE: ui/card.tsx ---',
      "import React from 'react'", // same import, different file — legit
      'export function Card() { return <div/> }', // Card defined here — legit
    ].join('\n')
    expect(findDuplicateTopLevelDeclaration(code)).toBeNull()
    const result = validateJavaScriptCode(code)
    expect(result.valid).toBe(true)
    // React import must survive in BOTH files
    expect((result.code.match(/import React from 'react'/g) || []).length).toBe(2)
  })

  it('still flags a duplicate WITHIN a single file of multi-file output', () => {
    const code = [
      '// --- FILE: App.tsx ---',
      "import { Card } from './ui/card'",
      "import { Card } from './aikit'", // duplicate within App.tsx
      'export default function App() { return <Card /> }',
    ].join('\n')
    const result = validateJavaScriptCode(code)
    // auto-fix should de-dupe the import and keep it valid
    expect(result.valid).toBe(true)
    expect(findDuplicateTopLevelDeclaration(result.code)).toBeNull()
  })

  it('handles aliased imports (X as Y) when detecting duplicates', () => {
    const code = [
      "import { Card as UICard } from './ui/card'",
      "import { Panel as UICard } from './ui/panel'", // alias collision on UICard
    ].join('\n')
    expect(findDuplicateTopLevelDeclaration(code)).toBe('UICard')
  })
})

/**
 * Same class of defect surfaced by the #64 regression run: a stray semicolon
 * splitting a ternary (accepted by Babel errorRecovery, fatal in Sandpack →
 * "Unexpected token, expected ':'"). Must be auto-fixed to strict-valid, or
 * rejected so the retry path re-generates — never a false 'success' that breaks.
 */
describe('code-validator: malformed ternary handling (#64 follow-up)', () => {
  const strictParses = (code: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@babel/parser').parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
      return true
    } catch {
      return false
    }
  }

  const badCases: Record<string, string> = {
    'stray ; before the ternary colon': "export default function App(){ const v = c ? 'a'\n : 'b';\n return <div className={v}/>; }",
    'stray ; after the true branch': "export default function App(){ const v =\n c ? 'x';\n : '';\n return <div className={v}/>; }",
    'stray ; before the question mark': "export default function App(){ const v = c;\n ? 'a'\n : 'b';\n return <div className={v}/>; }",
    'stray ; after arrow open paren': "export default function App(){ const f = (t) => (;\n <div>{t}</div>\n );\n return <div/>; }",
  }

  for (const [name, code] of Object.entries(badCases)) {
    it(`${name}: never a false success`, () => {
      const r = validateJavaScriptCode(code)
      // Either fixed (parses strictly) or explicitly invalid so retry engages.
      expect(r.valid === false || strictParses(r.code)).toBe(true)
    })
  }

  it('valid ternary still passes', () => {
    const code = "export default function App(){ const v = c ? 'a' : 'b'; return <div className={v}/>; }"
    expect(validateJavaScriptCode(code).valid).toBe(true)
  })

  it('JSX-recoverable code is not falsely rejected', () => {
    const code = "export default function App(){ return (<div><p>Hello & welcome</p></div>); }"
    expect(validateJavaScriptCode(code).valid).toBe(true)
  })
})

/**
 * Guard: rejecting "unexpected token" (so Sandpack-fatal code retries) must NOT
 * regress valid modern React/TS/JSX. These all pass strict parse and must stay
 * valid — this is the safety net for the broadened rejection (#64).
 */
describe('code-validator: no false positives on valid code (#64 guard)', () => {
  const valid: Record<string, string> = {
    fragment: 'export default function App(){ return <><h1>A</h1><p>B</p></>; }',
    'nested ternary chain': 'export default function App(){ const x=a?b:c?d:e; return <div>{x}</div>; }',
    'typescript generics': 'export default function App(){ const [s]=React.useState<string[]>([]); return <div>{s.length}</div>; }',
    'map arrow returning jsx': "export default function App(){ const items=[1,2]; return <ul>{items.map((i)=>(<li key={i}>{i}</li>))}</ul>; }",
    'template literal className': "export default function App(){ const a='x'; return <div className={`b ${a}`}/>; }",
    'optional chaining': 'export default function App(){ const o={a:{b:1}}; return <div>{o?.a?.b}</div>; }',
    'spread props': 'export default function App(){ const p={id:1}; return <div {...p}/>; }',
    'multiline import': "import {\n useState,\n useEffect\n} from 'react'\nexport default function App(){ const [n]=useState(0); useEffect(()=>{},[]); return <div>{n}</div>; }",
  }
  for (const [name, code] of Object.entries(valid)) {
    it(`valid: ${name}`, () => {
      expect(validateJavaScriptCode(code).valid, `${name} was wrongly rejected`).toBe(true)
    })
  }
})
