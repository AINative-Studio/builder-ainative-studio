import { describe, it, expect } from 'vitest'
import {
  findUnsafeDangerousHtml,
  findSecretLoggingCalls,
  countH1Tags,
  checkNoUnsafeDangerousHtml,
  checkNoSecretLogging,
  checkSingleH1,
  validateOutput,
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
