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
  findUnwiredDuplicateSidebar,
  checkNoUnwiredDuplicateSidebar,
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

  it('flags a dynamic arg that is a call with an object-literal param (nested brace before the real close)', () => {
    // A flat `[^}]+?` scan for the arg stops at the FIRST `}` — the object
    // literal's own close — so the required trailing `}}` never lines up
    // and this whole dangerouslySetInnerHTML call used to go completely
    // unmatched (not flagged safe, not flagged unsafe — just invisible).
    const code = `<div dangerouslySetInnerHTML={{ __html: renderMarkup({ body: userInput }) }} />`
    expect(findUnsafeDangerousHtml(code)).toEqual(['renderMarkup({ body: userInput })'])
  })

  it('flags an unsafe arg immediately followed by another safe occurrence', () => {
    const code = `
      <div dangerouslySetInnerHTML={{ __html: buildHtml({ raw: userInput }) }} />
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify({ ok: true }) }} />
    `
    expect(findUnsafeDangerousHtml(code)).toEqual(['buildHtml({ raw: userInput })'])
  })

  // Real bug: a comment between the opening `{{` and the real `__html:`
  // containing a stray, unmatched `}` used to close the brace-depth-count
  // right there, silently dropping the WHOLE call (not just truncating the
  // captured value) — a genuinely dangerous dynamic __html went completely
  // unflagged.
  it('still flags a dynamic __html value when a comment before it contains a stray }', () => {
    const code = `<div dangerouslySetInnerHTML={{ /* safe? (yes}) */ __html: userInput }} />`
    expect(findUnsafeDangerousHtml(code)).toHaveLength(1)
  })

  it('still flags a dynamic __html value when a //-comment on its own line contains a stray }', () => {
    const code = `<div dangerouslySetInnerHTML={{\n  // note: legacy shape used a wrapper object }\n  __html: userInput\n}} />`
    expect(findUnsafeDangerousHtml(code)).toHaveLength(1)
  })

  it('does not flag a static value when only a comment (no stray bracket) sits alongside it', () => {
    const code = `<div dangerouslySetInnerHTML={{ /* trusted, see #42 */ __html: "<b>Static</b>" }} />`
    expect(findUnsafeDangerousHtml(code)).toEqual([])
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

  // Real bug: a flat `\(([^)]*)\)` for the call's arguments stops at the
  // FIRST `)`, which a nested call expression among the arguments contains
  // — silently dropping everything after it, including the secret-shaped
  // argument that comes after the nested call.
  it('flags a secret-shaped arg that comes after a nested call expression', () => {
    const code = `console.log(formatValue(user), apiKey)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags a secret-shaped arg nested inside a call expression argument', () => {
    const code = `console.warn('token is', wrap(getToken()))`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('still finds a second, later console call after a nested-paren one', () => {
    const code = `console.log(formatValue(user));\nconsole.log('secret', apiKey);`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  // Real bug: the depth-counter had no notion of string content, so a lone,
  // unmatched `)` INSIDE a string argument -- e.g. a sad-face emoticon in a
  // user-facing error message -- was mistaken for the call's real closing
  // paren, truncating the scan before it ever reached the secret-shaped arg.
  it('flags a secret-shaped arg after a string argument containing an unmatched paren', () => {
    const code = `console.log('Checkout failed :(', apiKey)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags a secret-shaped arg after a template-literal argument containing an unmatched paren', () => {
    const code = 'console.warn(`Checkout failed :(`, authToken)'
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags a secret-shaped arg after a string argument containing an unmatched brace', () => {
    const code = `console.log('Use the { placeholder', apiKey)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  // Real bug: a comment before the secret-shaped arg containing a stray,
  // unmatched `)` used to close the paren-depth-count right there, silently
  // dropping the real arg this rule exists to catch.
  it('flags a secret-shaped arg after a comment containing a stray )', () => {
    const code = `console.log(/* ok) */ apiKey)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('flags a secret-shaped arg after a //-comment containing a stray )', () => {
    const code = `console.warn(\n  // legacy call shape) no longer used\n  authToken\n)`
    expect(findSecretLoggingCalls(code)).toHaveLength(1)
  })

  it('does not flag an ordinary call when only a comment (no stray paren) sits alongside it', () => {
    const code = `console.log(/* mounted */ 'Component mounted')`
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
    expect(result.checks).toHaveLength(4)
    expect(result.summary).toMatch(/All 4 output-validation checks passed/)
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
    expect(result.summary).toMatch(/3\/4 output-validation checks failed/)
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

/**
 * #815 — real, live-confirmed bug on /build/agentive-product: Cody generated
 * TWO real <aside> elements — the correct desktop sidebar (data-agent-context
 * ="sidebar") and a second "mobile" drawer (data-agent-context="sidebar-mobile")
 * with className="translate-x-0" and nothing else — no fixed/absolute
 * positioning, no -translate-x-full off-canvas default, no responsive
 * breakpoint hide class. It rendered permanently visible at every viewport
 * width, right next to the real sidebar. `document.querySelectorAll('aside').
 * length === 2` confirmed via direct DOM query in the live preview iframe.
 */
describe('findUnwiredDuplicateSidebar', () => {
  it('reproduces the exact #815 shape: mobile drawer with className="translate-x-0" and nothing else', () => {
    const code = `
      <aside data-agent-context="sidebar" className="flex flex-col bg-[#131726] text-white transition-all duration-300 sticky top-0 h-screen w-64">
        Desktop nav
      </aside>
      <aside data-agent-context="sidebar-mobile" className="translate-x-0">
        Mobile nav
      </aside>
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/sidebar-mobile/)
    expect(findings[0]).toMatch(/no off-canvas wiring/)
  })

  it('passes a correctly-wired mobile drawer: fixed + translate toggle + md:hidden', () => {
    const code = `
      <aside data-agent-context="sidebar" className="hidden md:flex md:flex-col bg-[#131726] text-white sticky top-0 h-screen w-64">
        Desktop nav
      </aside>
      <aside
        data-agent-context="sidebar-mobile"
        className={\`fixed inset-y-0 left-0 z-50 w-64 bg-[#131726] text-white transition-transform duration-300 md:hidden \${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}\`}
      >
        Mobile nav
      </aside>
    `
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('passes a responsive-only variant: fixed positioning + md:hidden with no translate class', () => {
    const code = `
      <aside data-agent-context="sidebar" className="hidden md:flex w-64">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" className="fixed inset-y-0 left-0 z-50 w-64 md:hidden">Mobile</aside>
    `
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('does not flag overlay positioning alone with no hide/show class at all', () => {
    const code = `
      <aside data-agent-context="sidebar" className="w-64">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" className="fixed inset-y-0 left-0 z-50 w-64">Mobile</aside>
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/sidebar-mobile/)
  })

  it('does not flag a single sidebar with no duplicate at all', () => {
    const code = `<aside data-agent-context="sidebar" className="w-64 sticky top-0 h-screen">Nav</aside>`
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('returns empty for code with no sidebar-role elements', () => {
    const code = `<div className="flex"><main>Content</main></div>`
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('never flags the primary "sidebar" role itself, even if unstyled', () => {
    const code = `
      <aside data-agent-context="sidebar" className="">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" className="fixed -translate-x-full md:hidden">Mobile</aside>
    `
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('still detects an unwired duplicate sidebar when an EARLIER attribute on the SAME tag has a JSX expression containing ">"', () => {
    // Real bug: a flat `[^>]*` scan for the tag's attrs treats the `>` inside
    // `{count > 0 ? ... : ...}` as the tag's own closing `>` and can never
    // re-sync past it, so the whole <aside> fails to match and silently
    // vanishes from this rule's view — the #815 duplicate-sidebar bug goes
    // completely undetected instead of being flagged.
    const code = `
      <aside data-agent-context="sidebar" className="w-64 fixed inset-y-0">Desktop</aside>
      <aside aria-label={count > 0 ? "has items" : "empty"} data-agent-context="sidebar-mobile" className="translate-x-0">Mobile</aside>
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/sidebar-mobile/)
    expect(findings[0]).toMatch(/no off-canvas wiring/)
  })

  it('still resolves the real className when a later attribute expression on the same tag contains ">"', () => {
    const code = `
      <aside data-agent-context="sidebar" className="w-64">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" title={depth > 1 ? "nested" : "top"} className="fixed inset-y-0 -translate-x-full md:hidden">Mobile</aside>
    `
    // Correctly wired (fixed + -translate-x-full + md:hidden) — should NOT be flagged.
    expect(findUnwiredDuplicateSidebar(code)).toEqual([])
  })

  it('still detects an unwired duplicate sidebar when it is self-closing with a ">" comparison attribute', () => {
    // Same bracket-scan bug as the two JSX-expression cases above, but for a
    // self-closing tag (`/>` instead of a child + `</aside>`) — a realistic
    // generated-code shape this rule must handle too.
    const code = `
      <aside data-agent-context="sidebar" className="w-64 fixed inset-y-0" />
      <aside aria-hidden={items.length > 0} data-agent-context="sidebar-mobile" className="translate-x-0" />
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/sidebar-mobile/)
  })

  it('is a pure function — same input always produces the same result', () => {
    const code = `
      <aside data-agent-context="sidebar" className="w-64">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" className="translate-x-0">Mobile</aside>
    `
    expect(findUnwiredDuplicateSidebar(code)).toEqual(findUnwiredDuplicateSidebar(code))
  })

  it('still detects an unwired duplicate sidebar when an earlier comment contains a stray } that throws off a later ">" comparison attribute', () => {
    // Real bug: a comment inside an earlier attribute's JSX expression
    // containing a stray, unmatched `}` decremented the brace-depth-count
    // one extra time. That alone is harmless IF nothing else follows before
    // the tag's real closing `>` — but a later attribute's own legitimate
    // ">" comparison (already handled correctly on its own, see the test
    // above) now lands at an off-by-one depth that reads as "outside any
    // expression", so ITS internal `>` is mistaken for the tag's real
    // closing `>`, truncating the tag early and dropping it from this
    // rule's view entirely.
    const code = `
      <aside data-agent-context="sidebar" className="w-64 fixed inset-y-0">Desktop</aside>
      <aside aria-label={/* note (see}ticket) */ 'nav'} aria-hidden={count > 0} data-agent-context="sidebar-mobile" className="translate-x-0">Mobile</aside>
    `
    const findings = findUnwiredDuplicateSidebar(code)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/sidebar-mobile/)
    expect(findings[0]).toMatch(/no off-canvas wiring/)
  })
})

describe('checkNoUnwiredDuplicateSidebar', () => {
  it('passes with just a name when there is no duplicate-sidebar bug', () => {
    const code = `<aside data-agent-context="sidebar" className="w-64">Nav</aside>`
    const result = checkNoUnwiredDuplicateSidebar(code)
    expect(result).toEqual({ name: 'no-unwired-duplicate-sidebar', passed: true })
  })

  it('fails with reason and details referencing #815 on the exact bug shape', () => {
    const code = `
      <aside data-agent-context="sidebar" className="w-64">Desktop</aside>
      <aside data-agent-context="sidebar-mobile" className="translate-x-0">Mobile</aside>
    `
    const result = checkNoUnwiredDuplicateSidebar(code)
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/#815/)
    expect(result.details).toHaveLength(1)
  })
})
