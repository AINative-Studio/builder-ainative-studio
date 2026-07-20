import { describe, it, expect } from 'vitest'
import { validateGeneratedCode, validateJavaScriptCode } from '@/lib/code-validator'

/**
 * Regression: a stray `;` splitting a multi-line method chain
 *   const filtered = items;
 *     .filter(...).map(...)
 * parses under Babel's errorRecovery but Sandpack rejects it with
 * "Unexpected token", which dropped the whole app to the validation-fallback
 * ("Refining your app") screen. This was the #1 cause of complex-app fallbacks
 * (ZeroInvoice, content-feed, knowledge-graph) — filter/map/reduce chains are
 * everywhere. Two parts: (1) the Fix-9 semicolon-inserter must NOT create it,
 * (2) the auto-fixer must REPAIR it if already present.
 */
describe('method-chain semicolon corruption', () => {
  it('Fix-9 does NOT append a ; when the value continues on the next line (.chain)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const items = [1,2,3]',
      '  const total = items',
      '    .filter(n => n > 1)',
      '    .reduce((a,b) => a + b, 0)',
      '  return <div>{total}</div>',
      '}',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
    // the declaration must not have been terminated before the chain
    expect(r.code).not.toMatch(/const total = items;\s*\n\s*\.filter/)
  })

  it('repairs a stray ; already splitting a chain (const x = arr;\\n.filter)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const invoices = [{status:"paid",total:5},{status:"pending",total:9}]',
      '  const outstanding = invoices;',
      "    .filter(inv => inv.status !== 'paid')",
      '    .reduce((s, inv) => s + inv.total, 0)',
      '  return <div>{outstanding}</div>',
      '}',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
    expect(r.code).not.toMatch(/invoices;\s*\n\s*\.filter/)
  })

  it('does NOT append ; when an arrow value opens on this line and closes later', () => {
    // const m = nodes.filter(node =>   (continues next line)
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const nodes = [{label:"A"}]',
      '  const matches = nodes.filter(node =>',
      '    node.label.toLowerCase().includes("a")',
      '  )',
      '  return <div>{matches.length}</div>',
      '}',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
    expect(r.code).not.toMatch(/node =>\s*;/)
  })

  it('STILL terminates a genuine single-line declaration (no false skip)', () => {
    const code = [
      "import React from 'react'",
      'export default function App() {',
      '  const name = "hello"',
      '  const count = 42',
      '  return <div>{name}{count}</div>',
      '}',
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
  })

  it('end-to-end: a data app with a filter/map/reduce chain validates (was fallback)', () => {
    const md = [
      '```tsx',
      "import React, { useState } from 'react'",
      'export default function App() {',
      '  const [q, setQ] = useState("")',
      '  const items = [{name:"a",price:2},{name:"b",price:8}]',
      '  const filtered = items',
      '    .filter(i => i.name.includes(q))',
      '    .map(i => ({ ...i, tax: i.price * 0.1 }))',
      '  const total = filtered',
      '    .reduce((s, i) => s + i.price, 0)',
      '  return <div><input value={q} onChange={e => setQ(e.target.value)} />{total}</div>',
      '}',
      '```',
    ].join('\n')
    const r = validateGeneratedCode(md)
    expect(r.valid).toBe(true)
  })
})
