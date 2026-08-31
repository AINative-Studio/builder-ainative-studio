import { describe, it, expect } from 'vitest'
import {
  findUnsafeDangerousHtml,
  findSecretLoggingCalls,
  countH1Tags,
  checkNoUnsafeDangerousHtml,
  checkNoSecretLogging,
  checkSingleH1,
  validateOutput,
  findMissingJsxImports,
  checkJsxImportsResolved,
  validateFileImports,
} from '@/lib/build/output-validator'

/**
 * #366 — real output validation of Cody-generated app code. Every rule here
 * is a deterministic string/regex scan (no LLM, no browser) — these tests
 * prove the heuristics against realistic generated-code snippets, both
 * compliant and violating, so the check can't silently pass everything.
 */

describe('findUnsafeDangerousHtml', () => {
  it('flags dangerouslySetInnerHTML referencing a variable', () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: userBio }} />`
    expect(findUnsafeDangerousHtml(code)).toEqual(['userBio'])
  })

  it('flags dangerouslySetInnerHTML referencing a fetch/state result', () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: apiResponse.content }} />`
    expect(findUnsafeDangerousHtml(code)).toHaveLength(1)
  })

  it('does not flag a static string literal', () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: "<b>Static</b>" }} />`
    expect(findUnsafeDangerousHtml(code)).toEqual([])
  })

  it('does not flag JSON.stringify(objectLiteral) — the JSON-LD pattern', () => {
    const code = `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@type": "WebSite", name: "App" }) }} />`
    expect(findUnsafeDangerousHtml(code)).toEqual([])
  })

  it('returns empty for code with no dangerouslySetInnerHTML at all', () => {
    expect(findUnsafeDangerousHtml('<div>Hello</div>')).toEqual([])
  })

  it('flags multiple unsafe occurrences independently', () => {
    const code = `
      <div dangerouslySetInnerHTML={{ __html: a }} />
      <div dangerouslySetInnerHTML={{ __html: b.value }} />
    `
    expect(findUnsafeDangerousHtml(code)).toHaveLength(2)
  })
})

describe('findSecretLoggingCalls', () => {
  it('flags console.log referencing an apiKey variable', () => {
    const code = `console.log(apiKey)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags console.log referencing process.env.SOMETHING_KEY', () => {
    const code = `console.log(process.env.STRIPE_SECRET_KEY)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags console.warn referencing a token', () => {
    const code = `console.warn('token is', authToken)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('does not flag an ordinary console.log', () => {
    const code = `console.log('Component mounted')`
    expect(findSecretLoggingCalls(code)).toEqual([])
  })

  it('does not flag console.error (only log/warn are checked, matching the issue scope)', () => {
    const code = `console.error(apiKey)`
    expect(findSecretLoggingCalls(code)).toEqual([])
  })
})

describe('countH1Tags', () => {
  it('counts exactly one h1', () => {
    expect(countH1Tags('<div><h1>Title</h1></div>')).toBe(1)
  })

  it('counts zero when no h1 present', () => {
    expect(countH1Tags('<div><h2>Section</h2></div>')).toBe(0)
  })

  it('counts multiple h1s (a violation)', () => {
    expect(countH1Tags('<h1>A</h1><section><h1>B</h1></section>')).toBe(2)
  })

  it('matches h1 with attributes, not just bare <h1>', () => {
    expect(countH1Tags('<h1 className="text-5xl">Title</h1>')).toBe(1)
  })

  it('does not miscount h1 as a substring of h10/h11-like tags (word boundary via [\\s>])', () => {
    // Not a real HTML tag, but guards the regex against loose matching.
    expect(countH1Tags('<h10>Not a heading</h10>')).toBe(0)
  })
})

describe('checkNoUnsafeDangerousHtml', () => {
  it('passes clean code', () => {
    const result = checkNoUnsafeDangerousHtml('<div>Hello</div>')
    expect(result.passed).toBe(true)
    expect(result.name).toBe('no-unsafe-dangerous-html')
  })

  it('fails with reason and details on violation', () => {
    const result = checkNoUnsafeDangerousHtml(`<div dangerouslySetInnerHTML={{ __html: bio }} />`)
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/1 dangerouslySetInnerHTML/)
    expect(result.details).toHaveLength(1)
  })
})

describe('checkNoSecretLogging', () => {
  it('passes clean code', () => {
    expect(checkNoSecretLogging(`console.log('ready')`).passed).toBe(true)
  })

  it('fails with reason on violation', () => {
    const result = checkNoSecretLogging(`console.log(secret)`)
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/1 console\.log/)
  })
})

describe('checkSingleH1', () => {
  it('passes with exactly one h1', () => {
    expect(checkSingleH1('<h1>Title</h1>').passed).toBe(true)
  })

  it('fails with zero h1s, with a distinct reason', () => {
    const result = checkSingleH1('<h2>No h1 here</h2>')
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/No <h1> found/)
  })

  it('fails with two+ h1s, with a distinct reason', () => {
    const result = checkSingleH1('<h1>A</h1><h1>B</h1>')
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/2 <h1> tags/)
  })
})

describe('validateOutput (aggregate)', () => {
  it('passes fully-compliant generated code', () => {
    const code = `
      <main aria-label="App">
        <h1>Welcome</h1>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@type": "WebSite" }) }} />
        <div>{console.log('mounted')}</div>
      </main>
    `
    const result = validateOutput(code)
    expect(result.passed).toBe(true)
    expect(result.checks).toHaveLength(3)
    expect(result.summary).toMatch(/All 3 output-validation checks passed/)
  })

  it('never fabricates a pass — aggregates every real violation', () => {
    const code = `
      <div dangerouslySetInnerHTML={{ __html: userInput }} />
      <div>{console.log('key is', apiKey)}</div>
    `
    const result = validateOutput(code)
    expect(result.passed).toBe(false)
    const failedNames = result.checks.filter((c) => !c.passed).map((c) => c.name)
    expect(failedNames).toEqual(
      expect.arrayContaining(['no-unsafe-dangerous-html', 'no-secret-logging', 'single-h1'])
    )
    expect(result.summary).toMatch(/3\/3 output-validation checks failed/)
  })

  it('is a pure function — same input always produces the same result', () => {
    const code = '<h1>Stable</h1>'
    expect(validateOutput(code)).toEqual(validateOutput(code))
  })
})

/**
 * #384 — real, user-reported crash (Driftwood, jason@adamandella.com): JSX
 * used a component (Card, Button, Select, ...) with no import binding, even
 * though the component's own file existed elsewhere in the same multi-file
 * payload. Guaranteed `ReferenceError` at render. Distinct from and unguarded
 * by both #366's original 3 rules and completeness-gate.ts's
 * findMissingLocalImports (opposite direction: import STATEMENTS resolving,
 * not JSX USES being imported).
 */
describe('findMissingJsxImports', () => {
  it('reproduces the exact Driftwood failure shape: JSX uses Card/Button/Select with zero imports', () => {
    const code = `
      import AIKitHeader from './components/aikit/AIKitHeader'

      export default function App() {
        return (
          <div>
            <AIKitHeader />
            <Card>
              <CardHeader><CardTitle>Settings</CardTitle></CardHeader>
              <CardContent>
                <Label>Name</Label>
                <Input />
                <Select>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="a">A</SelectItem></SelectContent>
                </Select>
                <Button>Save</Button>
              </CardContent>
            </Card>
          </div>
        )
      }
    `
    const missing = findMissingJsxImports(code)
    expect(missing).toEqual(
      ['Button', 'Card', 'CardContent', 'CardHeader', 'CardTitle', 'Input', 'Label', 'Select', 'SelectContent', 'SelectItem', 'SelectTrigger', 'SelectValue'].sort()
    )
    // AIKitHeader IS imported — must never be flagged as missing.
    expect(missing).not.toContain('AIKitHeader')
  })

  it('does not flag a component defined locally in the same file (function declaration)', () => {
    const code = `
      function Badge() { return <span>New</span> }
      export default function App() {
        return <div><Badge /></div>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('does not flag a component defined locally in the same file (const arrow function)', () => {
    const code = `
      const Badge = () => <span>New</span>
      export default function App() {
        return <div><Badge /></div>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('does not flag an aliased named import', () => {
    const code = `
      import { Button as PrimaryButton } from './components/ui/button'
      export default function App() {
        return <div><PrimaryButton /></div>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('does not flag a default + named import on one line', () => {
    const code = `
      import App, { Header } from './App'
      export default function Root() {
        return <App><Header /></App>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('does not flag a multi-line named import clause', () => {
    const code = `
      import {
        Card,
        CardHeader,
        CardContent,
      } from './components/ui/card'
      export default function App() {
        return <Card><CardHeader /><CardContent /></Card>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('checks only the base identifier for namespaced JSX (<Foo.Bar>) — Bar is a property access, not a binding', () => {
    const code = `
      import * as Icons from './icons'
      export default function App() {
        return <div><Icons.Star /></div>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('still flags a namespaced JSX base identifier that truly has no binding', () => {
    const code = `
      export default function App() {
        return <div><Icons.Star /></div>
      }
    `
    expect(findMissingJsxImports(code)).toEqual(['Icons'])
  })

  it('never flags lowercase tags (real DOM elements)', () => {
    const code = `export default function App() { return <div><span>hi</span></div> }`
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('never flags React.Fragment / bare <Fragment>', () => {
    const code = `
      import { Fragment } from 'react'
      export default function App() {
        return <Fragment><div>a</div></Fragment>
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('does not flag an import type clause as a value binding (erased at runtime) but also does not falsely flag real usage', () => {
    const code = `
      import type { CardProps } from './types'
      import { Card } from './components/ui/card'
      export default function App() {
        return <Card />
      }
    `
    expect(findMissingJsxImports(code)).toEqual([])
  })

  it('returns empty for code with no JSX at all', () => {
    expect(findMissingJsxImports('const x = 1')).toEqual([])
  })
})

describe('checkJsxImportsResolved', () => {
  it('passes when every used component is imported', () => {
    const code = `import { Button } from './button'; export default () => <Button />`
    const result = checkJsxImportsResolved(code)
    expect(result.passed).toBe(true)
    expect(result.name).toBe('jsx-imports-resolved')
  })

  it('fails with reason and details on the Driftwood shape', () => {
    const code = `export default () => <Card><Button /></Card>`
    const result = checkJsxImportsResolved(code)
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/2 JSX component/)
    expect(result.details).toEqual(['Button', 'Card'])
  })
})

describe('validateFileImports (multi-file aggregate)', () => {
  it('reproduces Driftwood exactly: App.tsx missing imports, ui files themselves are fine, ignores non-code files', () => {
    const files: Record<string, string> = {
      '/src/App.tsx': `
        import AIKitHeader from './components/aikit/AIKitHeader'
        export default function App() {
          return <div><AIKitHeader /><Card><Button>Save</Button></Card></div>
        }
      `,
      '/src/components/ui/card.tsx': `export function Card({ children }: any) { return <div>{children}</div> }`,
      '/src/components/ui/button.tsx': `export function Button({ children }: any) { return <button>{children}</button> }`,
      '/public/robots.txt': `User-agent: *`,
    }
    const result = validateFileImports(files)
    expect(result.passed).toBe(false)
    expect(result.checks).toHaveLength(3) // App.tsx + card.tsx + button.tsx — robots.txt excluded
    const appCheck = result.checks.find((c) => c.name === '/src/App.tsx')
    expect(appCheck?.passed).toBe(false)
    expect(appCheck?.details).toEqual(['Button', 'Card'])
    // card.tsx and button.tsx each define their own component — both pass on their own.
    expect(result.checks.find((c) => c.name === '/src/components/ui/card.tsx')?.passed).toBe(true)
    expect(result.checks.find((c) => c.name === '/src/components/ui/button.tsx')?.passed).toBe(true)
    expect(result.summary).toMatch(/1\/3 file\(s\)/)
  })

  it('passes a fully-compliant multi-file payload', () => {
    const files: Record<string, string> = {
      '/src/App.tsx': `
        import { Card } from './components/ui/card'
        export default function App() { return <Card /> }
      `,
      '/src/components/ui/card.tsx': `export function Card() { return <div /> }`,
    }
    const result = validateFileImports(files)
    expect(result.passed).toBe(true)
    expect(result.summary).toMatch(/All 2 file\(s\)/)
  })

  it('never fabricates a result — an empty files map passes trivially with zero checks', () => {
    const result = validateFileImports({})
    expect(result.passed).toBe(true)
    expect(result.checks).toEqual([])
  })

  it('is a pure function — same input always produces the same result', () => {
    const files = { '/src/App.tsx': `export default () => <Card />` }
    expect(validateFileImports(files)).toEqual(validateFileImports(files))
  })
})
