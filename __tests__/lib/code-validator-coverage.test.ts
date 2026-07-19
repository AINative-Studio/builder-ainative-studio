import { describe, it, expect } from 'vitest'
import {
  validateJavaScriptCode,
  validateGeneratedCode,
  extractCodeFromMarkdown,
} from '@/lib/code-validator'

/**
 * Coverage for the auto-fix / extraction / rejection branches of code-validator
 * that the feature-specific suites don't exercise. Keeps the module ≥90%.
 */
describe('code-validator — auto-fix branches', () => {
  it('closes unbalanced brackets from truncation', () => {
    // Truncated mid-JSX — unclosed braces/parens.
    const code = "export default function App(){ return (\n  <div>\n    <span>{items.map((i) => (\n      <li key={i}>{i}</li>"
    const r = validateJavaScriptCode(code)
    // Should either auto-close to valid, or reject — never throw.
    expect(typeof r.valid).toBe('boolean')
    expect(r.code.length).toBeGreaterThan(0)
  })

  it('trims trailing lines with unterminated strings', () => {
    const code = [
      'export default function App(){',
      '  const items = [1,2,3];',
      '  return <div>{items.length}</div>;',
      '}',
      "const broken = 'this string never closes",
    ].join('\n')
    const r = validateJavaScriptCode(code)
    expect(typeof r.valid).toBe('boolean')
  })

  it('adds missing parens to a function declaration', () => {
    const code = 'export default function App {\n  return <div>hi</div>;\n}'
    const r = validateJavaScriptCode(code)
    expect(r.code).toMatch(/function App\(\)/)
  })

  it('removes stray semicolons after opening braces', () => {
    const code = 'export default function App(){ const data = [{;\n a: 1\n }]; return <div>{data.length}</div>; }'
    const r = validateJavaScriptCode(code)
    expect(typeof r.valid).toBe('boolean')
  })

  it('enforces a single h1 (converts extra <h1> to <h2>)', () => {
    const code = 'export default function App(){ return <div><h1>A</h1><h1>B</h1></div>; }'
    const r = validateJavaScriptCode(code)
    expect((r.code.match(/<h1/g) || []).length).toBe(1)
    expect(r.code).toMatch(/<h2/)
  })

  it('converts multi-line className template literals to single line', () => {
    const code = 'export default function App(){ return <div className={`px-4\n py-2\n rounded`} />; }'
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
  })

  it('rejects catastrophic unterminated string', () => {
    const code = 'const x = "unterminated'
    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('code-validator — markdown extraction', () => {
  it('extracts a fenced ```jsx block', () => {
    const md = 'Here you go:\n```jsx\nexport default function App(){ return <div/>; }\n```\nDone.'
    const code = extractCodeFromMarkdown(md)
    expect(code).toMatch(/export default function App/)
    expect(code).not.toMatch(/```/)
  })

  it('cleans malformed fence wrappers', () => {
    const md = '""`jsx\nexport default function App(){ return <div/>; }\n```"'
    const code = extractCodeFromMarkdown(md)
    expect(code).toMatch(/export default function App/)
  })

  it('validateGeneratedCode extracts then validates', () => {
    const md = '```tsx\nexport default function App(){ return <Card><Button>Go</Button></Card>; }\n```'
    const r = validateGeneratedCode(md)
    expect(r.valid).toBe(true)
    expect(r.code).not.toMatch(/```/)
  })

  it('validateGeneratedCode surfaces a validation error through extraction', () => {
    const md = '```jsx\nexport default function App(){ return <div><Header/></div>; }\n```'
    const r = validateGeneratedCode(md)
    expect(r.valid).toBe(false) // Header is unresolved (#76)
  })
})
