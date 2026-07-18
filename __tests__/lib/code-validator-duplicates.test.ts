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
